import type { MarkdownView } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
 afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';

import type {
 PropertyFieldNode, SourcePropertyFieldNode
} from './property-field-tree.ts';

import { PluginSettings } from './plugin-settings.ts';
import {
 buildPropertyFieldForest, flattenPropertyFieldForest, parseSourcePropertyFields
} from './property-field-tree.ts';
import { PropertyFieldVisualsComponent } from './property-field-visuals.ts';

interface NavigationComponent {
  documentStates: Map<Document, NavigationDocumentState>;
  highlightVisibleSourceLine(): void;
  observeDocument(doc: Document): void;
  schedulePopoverHide(doc: Document): void;
  showDomBreadcrumb(doc: Document, roots: PropertyFieldNode[], current: PropertyFieldNode, anchor: HTMLElement): void;
  showSourceBreadcrumb(doc: Document, roots: SourcePropertyFieldNode[], current: SourcePropertyFieldNode, anchor: HTMLElement, view: MarkdownView): void;
}

interface NavigationDocumentState {
  bodyStyleObserver: MutationObserver | null;
  cleanups: (() => void)[];
  mutationObserver: MutationObserver | null;
  popover: HTMLElement | null;
}

let component: NavigationComponent;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const settings = new PluginSettings();
  settings.globalHoverBreadcrumbPopoverTimeoutSeconds = 0.02;
  component = castTo<NavigationComponent>(new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
    app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
    pluginSettingsComponent: { settings }
  })));
  component.observeDocument(document);
  component.highlightVisibleSourceLine = vi.fn();
});

afterEach(() => {
  const state = component.documentStates.get(document);
  state?.mutationObserver?.disconnect();
  state?.bodyStyleObserver?.disconnect();
  for (const cleanup of state?.cleanups ?? []) {
    cleanup();
  }
  component.documentStates.clear();
  document.body.replaceChildren();
  Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
  vi.useRealTimers();
});

describe('breadcrumb navigation owns the editor caret independently of hover and dismissal', () => {
  it.each(['root', 'child'])('should single-click to the end of the Live Preview %s key and retain focus after other breadcrumb hovers and timeout', (name) => {
    const source = document.body.createDiv({ cls: 'markdown-source-view is-live-preview' });
    const container = source.createDiv({ cls: 'metadata-container' });
    const root = container.createDiv({ cls: 'metadata-property' });
    const rootKey = root.createDiv({ cls: 'metadata-property-key' }).createEl('input', { cls: 'metadata-property-key-input', value: 'root' });
    const child = root.createDiv({ cls: 'metadata-property-value' }).createDiv({ cls: 'metadata-property' });
    const childKey = child.createDiv({ cls: 'metadata-property-key' }).createEl('input', { cls: 'metadata-property-key-input', value: 'child' });
    const roots = buildPropertyFieldForest(container);
    const current = flattenPropertyFieldForest(roots).at(-1);
    if (current === undefined) {
      throw new Error('Missing fixture node');
    }
    const input = name === 'root' ? rootKey : childKey;
    input.setSelectionRange(0, 0);
    component.showDomBreadcrumb(document, roots, current, child);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.np-property-breadcrumb-key')];
    buttons.find((button) => button.textContent === name)?.click();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([name.length, name.length]);
    buttons.find((button) => button.textContent !== name)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.activeElement).toBe(input);
    component.schedulePopoverHide(document);
    vi.advanceTimersByTime(21);
    expect(document.querySelector('.np-property-breadcrumb-popover')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([name.length, name.length]);
  });

  it.each(['root', 'child'])('should single-click to the Source %s line end and retain focus after other breadcrumb hovers and timeout', (name) => {
    const text = '---\nroot:\n  child: value\n---';
    const source = document.body.createDiv({ cls: 'markdown-source-view' });
    const content = source.createDiv({ attr: { tabindex: '0' }, cls: 'cm-content' });
    const line = content.createDiv({ cls: 'cm-line' });
    const setCursor = vi.fn();
    const view = castTo<MarkdownView>({
      containerEl: source,
      editor: {
        focus: (): void => { content.focus(); },
        getLine: (index: number): string => text.split('\n')[index] ?? '',
        setCursor
      }
    });
    const roots = parseSourcePropertyFields(text);
    const current = flattenPropertyFieldForest(roots).at(-1);
    if (current === undefined) {
      throw new Error('Missing fixture node');
    }
    component.showSourceBreadcrumb(document, roots, current, line, view);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.np-property-breadcrumb-key')];
    buttons.find((button) => button.textContent === name)?.click();
    const lineNumber = name === 'root' ? 1 : 2;
    expect(setCursor).toHaveBeenLastCalledWith({ ch: text.split('\n')[lineNumber]?.length, line: lineNumber });
    expect(document.activeElement).toBe(content);
    buttons.find((button) => button.textContent !== name)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.activeElement).toBe(content);
    component.schedulePopoverHide(document);
    vi.advanceTimersByTime(21);
    expect(document.querySelector('.np-property-breadcrumb-popover')).toBeNull();
    expect(document.activeElement).toBe(content);
    expect(setCursor).toHaveBeenCalledTimes(1);
  });
});
