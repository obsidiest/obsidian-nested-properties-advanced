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
  readonly ownerWindow: Window;
  readonly resizeObserver: ResizeObserver;
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
  private readonly frames = new Map<Window, number>();
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
        this.schedule(view.dom.win);
        return {
          destroy: (): void => {
            this.editors.delete(view);
          },
          update: (update): void => {
            if (update.docChanged || update.startState.field(livePreviewField, false) !== update.state.field(livePreviewField, false)) {
              this.schedule(view.dom.win);
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
    for (const [ownerWindow, frame] of this.frames) {
      ownerWindow.cancelAnimationFrame(frame);
    }
    this.frames.clear();
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

  private clearFields(record: ObservedPropertyView): void {
    for (const [raw, rendered] of record.fields) {
      this.removeField(raw, rendered);
    }
    record.fields.clear();
  }

  private clearView(record: ObservedPropertyView): void {
    record.observer.disconnect();
    record.resizeObserver.disconnect();
    record.cleanup();
    this.clearFields(record);
  }

  private observeView(view: MarkdownView): ObservedPropertyView {
    const root = view.containerEl;
    const ownerWindow = root.win;
    const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new Observer((mutations) => {
      if (
        mutations.some((mutation) => {
          const target = getHtmlElement(mutation.target);
          if (mutation.type === 'attributes') {
            return target?.matches('.markdown-source-view') === true
              && (mutation.oldValue ?? '').split(/\s+/u).includes('is-live-preview') !== target.classList.contains('is-live-preview');
          }
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
        this.schedule(root.win);
      }
    });
    observer.observe(root, { attributeFilter: ['class'], attributeOldValue: true, attributes: true, characterData: true, childList: true, subtree: true });
    const schedule = (): void => {
      this.schedule(root.win);
    };
    // A hidden/restoring tab may have no metadata or usable editor geometry yet.
    // Keep its lifecycle observation alive so becoming visible can start rendering.
    const ResizeObserverConstructor = root.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const resizeObserver = new ResizeObserverConstructor(schedule);
    resizeObserver.observe(root);
    // Reveal a native control synchronously when navigation or Tab focuses it.
    const reveal = (event: FocusEvent): void => {
      const raw = getHtmlElement(event.target);
      const record = raw === null ? undefined : this.views.get(view)?.fields.get(raw);
      if (raw !== null && record !== undefined) {
        raw.classList.remove('np-rich-property-raw');
        record.label.hidden = true;
      }
      this.schedule(root.win);
    };
    root.addEventListener('focusin', reveal, { capture: true });
    root.addEventListener('focusout', schedule, { capture: true });
    const record: ObservedPropertyView = {
      cleanup: () => {
        root.removeEventListener('focusin', reveal, true);
        root.removeEventListener('focusout', schedule, true);
      },
      fields: new Map(),
      observer,
      ownerWindow,
      resizeObserver
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
    for (const row of view.containerEl.querySelectorAll<HTMLElement>(':scope .metadata-container .metadata-property')) {
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

  private renderVisibleViews(ownerWindow: Window): void {
    const openViews = new Set<MarkdownView>();
    for (const { view } of this.app.workspace.getLeavesOfType('markdown')) {
      if (view instanceof MarkdownView) {
        openViews.add(view);
      }
    }
    for (const [view, record] of this.views) {
      if (openViews.has(view) && record.ownerWindow === view.containerEl.win && !record.ownerWindow.closed) {
        continue;
      }

      this.clearView(record);
      this.views.delete(view);
    }
    for (const view of openViews) {
      if (view.containerEl.win !== ownerWindow) {
        continue;
      }
      const record = this.views.get(view) ?? this.observeView(view);
      const mode = view.getMode() === 'preview' ? 'reading' : (view.containerEl.querySelector('.markdown-source-view.is-live-preview') ? 'live-preview' : 'source');
      if (view.containerEl.getBoundingClientRect().width === 0 || mode === 'source' || !isRichPropertyRenderingEnabled(this.settings.settings, mode)) {
        this.clearFields(record);
        continue;
      }
      this.renderFields(view, record);
    }
  }

  private schedule(ownerWindow?: Window): void {
    if (!this.isActive) {
      return;
    }
    for (const target of this.frames.keys()) {
      if (target.closed) {
        this.frames.delete(target);
      }
    }
    const windows = new Set(ownerWindow === undefined ? [window] : [ownerWindow]);
    if (ownerWindow === undefined) {
      for (const { view } of this.app.workspace.getLeavesOfType('markdown')) {
        windows.add(view.containerEl.win);
      }
    }
    for (const target of windows) {
      if (target.closed || this.frames.has(target)) {
        continue;
      }
      // A popout must not wait for animation frames in a hidden main window.
      this.frames.set(
        target,
        target.requestAnimationFrame(() => {
          this.frames.delete(target);
          this.renderVisibleViews(target);
        })
      );
    }
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
