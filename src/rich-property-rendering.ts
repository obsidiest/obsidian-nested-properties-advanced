/* v8 ignore file -- The native metadata editor and CodeMirror lifecycle are covered by desktop integration tests. */
import type {
  EditorState,
  Extension,
  Text
} from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type {
  App,
  MarkdownFileInfo
} from 'obsidian';

import {
  StateEffect,
  StateField
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType
} from '@codemirror/view';
import {
  Component,
  editorInfoField,
  editorLivePreviewField,
  MarkdownView
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PropertySourceContent } from './property-source-content.ts';

import { getHtmlElement } from './dom-target.ts';
import { dispatchPropertyFieldLayoutChange } from './property-field-events.ts';
import { collectPropertySourceContent } from './property-source-content.ts';
import {
  didHandleRichPropertyLink,
  hasRichPropertySyntax,
  isRichPropertyRenderingEnabled,
  PropertyRenderScopeComponent,
  renderRichPropertyContent
} from './rich-property-content.ts';

// Obsidian's declarations use the CJS CodeMirror types; the runtime uses the same host fields.
const livePreviewField = castTo<StateField<boolean>>(editorLivePreviewField);
const infoField = castTo<StateField<MarkdownFileInfo>>(editorInfoField);
const refreshSourceRendering = StateEffect.define();
const richLabelSelector = '.np-rich-property-label';
const sourceRenderScopes = new WeakMap<HTMLElement, PropertyRenderScopeComponent>();

interface ObservedPropertyView {
  cleanup(): void;
  readonly fields: Map<HTMLElement, RenderedField>;
  readonly observer: MutationObserver;
}

interface RenderedField {
  readonly label: HTMLElement;
  readonly path: string;
  readonly scope: PropertyRenderScopeComponent;
  readonly source: string;
}

class PropertySourceWidget extends WidgetType {
  public constructor(private readonly owner: Component, private readonly app: App, private readonly content: PropertySourceContent, private readonly path: string) {
    super();
  }

  public override destroy(dom: HTMLElement): void {
    sourceRenderScopes.get(dom)?.dispose();
    sourceRenderScopes.delete(dom);
  }

  public override eq(other: PropertySourceWidget): boolean {
    return this.content.source === other.content.source && this.content.from === other.content.from && this.content.to === other.content.to && this.path === other.path;
  }

  public override ignoreEvent(): boolean {
    return true;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const label = view.dom.ownerDocument.win.createSpan();
    label.className = 'np-rich-source-property';
    label.dataset['propertyFrom'] = String(this.content.from);
    const scope = new PropertyRenderScopeComponent(this.owner);
    sourceRenderScopes.set(label, scope);
    label.addEventListener('click', (event) => {
      if (didHandleRichPropertyLink(this.app, event, this.path)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.content.editAt } });
      view.focus();
    }, { capture: true });
    invokeAsyncSafely(() =>
      renderRichPropertyContent(this.app, this.content.source, label, this.path, scope).then(() => {
        if (scope.isDisposed || !label.isConnected) {
          return;
        }

        view.requestMeasure();
        dispatchPropertyFieldLayoutChange(label);
      })
    );
    return label;
  }
}

/**
Native inputs retain ownership of editing; their inactive display is rendered separately.
*/
export class RichPropertyRenderingComponent extends Component {
  private readonly editors = new Set<EditorView>();
  private frame: null | number = null;
  private isActive = false;
  private readonly sourceContent = new WeakMap<Text, PropertySourceContent[]>();
  private readonly views = new Map<MarkdownView, ObservedPropertyView>();

  public constructor(private readonly app: App, private readonly settings: PluginSettingsComponent) {
    super();
  }

  public createEditorExtension(): Extension {
    const decorations = StateField.define<DecorationSet>({
      create: (state) => this.sourceDecorations(state),
      provide: (field) => EditorView.decorations.from(field),
      update: (previous, transaction) => {
        if (
          transaction.docChanged || transaction.selection !== undefined || transaction.effects.some((effect) => effect.is(refreshSourceRendering))
          || transaction.startState.field(livePreviewField, false) !== transaction.state.field(livePreviewField, false)
        ) {
          return this.sourceDecorations(transaction.state);
        }
        return previous;
      }
    });
    return [
      decorations,
      EditorView.atomicRanges.of((view) => view.state.field(decorations)),
      ViewPlugin.define((view) => {
        this.editors.add(view);
        this.schedule();
        return {
          destroy: (): void => {
            this.editors.delete(view);
          },
          update: (update): void => {
            if (update.docChanged || update.startState.field(livePreviewField, false) !== update.state.field(livePreviewField, false)) {
              this.schedule();
            }
          }
        };
      })
    ];
  }

  public override onload(): void {
    this.isActive = true;
    this.app.workspace.onLayoutReady(() => {
      this.schedule();
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.schedule();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      this.schedule();
    }));
    this.registerEvent(this.app.workspace.on('file-open', () => {
      this.schedule();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', () => {
      this.schedule();
    }));
  }

  public override onunload(): void {
    this.isActive = false;
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame);
    }
    for (const record of this.views.values()) {
      this.clearView(record);
    }
    this.views.clear();
    this.editors.clear();
  }

  public refresh(): void {
    for (const editor of this.editors) {
      editor.dispatch({ effects: refreshSourceRendering.of(null) });
    }
    this.schedule();
  }

  private clearView(record: ObservedPropertyView): void {
    record.observer.disconnect();
    record.cleanup();
    for (const [raw, rendered] of record.fields) {
      this.removeField(raw, rendered);
    }
    record.fields.clear();
  }

  private observeView(view: MarkdownView): ObservedPropertyView {
    const Observer = view.containerEl.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new Observer((mutations) => {
      if (
        mutations.some((mutation) => {
          const target = getHtmlElement(mutation.target);
          if (target?.closest(richLabelSelector)) {
            return false;
          }
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          if (nodes.length > 0 && nodes.every((node) => getHtmlElement(node)?.matches(richLabelSelector) === true)) {
            return false;
          }
          return Boolean(target?.closest('.metadata-container')) || nodes.some((node) => getHtmlElement(node)?.matches('.metadata-container') === true || Boolean(getHtmlElement(node)?.querySelector('.metadata-container')));
        })
      ) {
        this.schedule();
      }
    });
    observer.observe(view.contentEl, { characterData: true, childList: true, subtree: true });
    const schedule = (): void => {
      this.schedule();
    };
    // Reveal a native control synchronously when navigation or Tab focuses it.
    const reveal = (event: FocusEvent): void => {
      const raw = getHtmlElement(event.target);
      const record = raw === null ? undefined : this.views.get(view)?.fields.get(raw);
      if (raw !== null && record !== undefined) {
        raw.classList.remove('np-rich-property-raw');
        record.label.hidden = true;
      }
      this.schedule();
    };
    view.contentEl.addEventListener('focusin', reveal, { capture: true });
    view.contentEl.addEventListener('focusout', schedule, { capture: true });
    const record: ObservedPropertyView = {
      cleanup: () => {
        view.contentEl.removeEventListener('focusin', reveal, true);
        view.contentEl.removeEventListener('focusout', schedule, true);
      },
      fields: new Map(),
      observer
    };
    this.views.set(view, record);
    return record;
  }

  private removeField(raw: HTMLElement, rendered: RenderedField): void {
    raw.classList.remove('np-rich-property-raw');
    rendered.label.remove();
    rendered.scope.dispose();
    if (!raw.parentElement?.querySelector(richLabelSelector)) {
      raw.parentElement?.classList.remove('np-rich-property-holder');
    }
  }

  private renderField(record: ObservedPropertyView, wanted: Set<HTMLElement>, raw: HTMLElement, source: string, path: string): void {
    if (!hasRichPropertySyntax(source) || raw.contains(raw.ownerDocument.activeElement)) {
      return;
    }
    wanted.add(raw);
    const previous = record.fields.get(raw);
    if (previous?.source === source && previous.path === path && previous.label.isConnected) {
      raw.classList.add('np-rich-property-raw');
      previous.label.hidden = false;
      return;
    }
    if (previous !== undefined) {
      this.removeField(raw, previous);
    }
    const label = raw.ownerDocument.win.createSpan();
    label.className = 'np-rich-property-label';
    label.textContent = source;
    raw.before(label);
    raw.parentElement?.classList.add('np-rich-property-holder');
    raw.classList.add('np-rich-property-raw');
    const scope = new PropertyRenderScopeComponent(this);
    record.fields.set(raw, { label, path, scope, source });
    label.addEventListener('click', (event) => {
      if (didHandleRichPropertyLink(this.app, event, path)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      raw.classList.remove('np-rich-property-raw');
      label.hidden = true;
      raw.focus();
      if (raw.matches('input, textarea')) {
        const input = raw as HTMLInputElement;
        input.setSelectionRange(input.value.length, input.value.length);
      } else if (raw.isContentEditable) {
        const range = raw.ownerDocument.createRange();
        range.selectNodeContents(raw);
        range.collapse(false);
        raw.ownerDocument.getSelection()?.removeAllRanges();
        raw.ownerDocument.getSelection()?.addRange(range);
      } else {
        raw.click();
      }
    }, { capture: true });
    invokeAsyncSafely(() =>
      renderRichPropertyContent(this.app, source, label, path, scope).then(() => {
        if (!scope.isDisposed && label.isConnected) {
          dispatchPropertyFieldLayoutChange(label);
        }
      })
    );
  }

  private renderFields(view: MarkdownView, record: ObservedPropertyView): void {
    const wanted = new Set<HTMLElement>();
    const path = view.file?.path ?? '';
    for (const row of view.contentEl.querySelectorAll<HTMLElement>(':scope .metadata-container .metadata-property')) {
      const key = row.querySelector<HTMLInputElement>(':scope > .metadata-property-key .metadata-property-key-input');
      if (key !== null) {
        this.renderField(record, wanted, key, key.value, path);
      }
      const value = getPropertyValue(view, row);
      const valueEl = row.querySelector<HTMLElement>(':scope > .metadata-property-value');
      if (typeof value === 'string') {
        const control = valueEl?.querySelector<HTMLElement>('textarea, input[type="text"], [contenteditable="true"]');
        if (control?.closest('.metadata-property') === row) {
          this.renderField(record, wanted, control, value, path);
        }
      } else if (Array.isArray(value)) {
        const pills = valueEl?.querySelectorAll<HTMLElement>('.multi-select-pill-content') ?? [];
        for (const [index, pill] of [...pills].entries()) {
          const item: unknown = value[index];
          if (typeof item === 'string' && pill.closest('.metadata-property') === row) {
            this.renderField(record, wanted, pill, item, path);
          }
        }
      }
    }
    for (const [raw, rendered] of record.fields) {
      if (wanted.has(raw)) {
        continue;
      }

      this.removeField(raw, rendered);
      record.fields.delete(raw);
    }
  }

  private renderVisibleViews(): void {
    const visible = new Set<MarkdownView>();
    for (const { view } of this.app.workspace.getLeavesOfType('markdown')) {
      if (!(view instanceof MarkdownView) || view.containerEl.getBoundingClientRect().width === 0) {
        continue;
      }
      const mode = view.getMode() === 'preview' ? 'reading' : (view.contentEl.querySelector('.markdown-source-view.is-live-preview') ? 'live-preview' : 'source');
      if (mode === 'source' || !isRichPropertyRenderingEnabled(this.settings.settings, mode)) {
        continue;
      }
      visible.add(view);
      const record = this.views.get(view) ?? this.observeView(view);
      this.renderFields(view, record);
    }
    for (const [view, record] of this.views) {
      if (visible.has(view)) {
        continue;
      }

      this.clearView(record);
      this.views.delete(view);
    }
  }

  private schedule(): void {
    if (!this.isActive || this.frame !== null) {
      return;
    }
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.renderVisibleViews();
    });
  }

  private sourceDecorations(state: EditorState): DecorationSet {
    if (state.field(livePreviewField, false) !== false || !isRichPropertyRenderingEnabled(this.settings.settings, 'source')) {
      return Decoration.none;
    }
    const path = state.field(infoField, false)?.file?.path ?? '';
    let contents = this.sourceContent.get(state.doc);
    if (contents === undefined) {
      contents = collectPropertySourceContent(state.doc.toString());
      this.sourceContent.set(state.doc, contents);
    }
    const ranges = contents.filter((part) => {
      const start = state.doc.lineAt(part.from).from;
      const end = state.doc.lineAt(part.to).to;
      return state.selection.ranges.every((selection) => !(selection.from <= end && selection.to >= start));
    }).map((part) => Decoration.replace({ widget: new PropertySourceWidget(this, this.app, part, path) }).range(part.from, part.to));
    return Decoration.set(ranges, true);
  }
}

function getPropertyValue(view: MarkdownView, row: HTMLElement): unknown {
  const keys: string[] = [];
  let current: HTMLElement | null = row;
  while (current !== null) {
    const currentRow = current;
    const root = view.metadataEditor.rendered.find((property) => property.containerEl === currentRow);
    if (root !== undefined) {
      let value = root.entry.value;
      for (const key of keys.reverse()) {
        value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
      }
      return value;
    }
    const input = current.querySelector<HTMLInputElement>(':scope > .metadata-property-key .metadata-property-key-input');
    if (input === null) {
      return undefined;
    }
    keys.push(input.value);
    current = current.parentElement?.closest<HTMLElement>('.metadata-property') ?? null;
  }
  return undefined;
}
