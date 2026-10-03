import type { MarkdownView } from 'obsidian';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  PropertyFieldNode,
  SourcePropertyFieldNode
} from './property-field-tree.ts';

import { PluginSettings } from './plugin-settings.ts';
import {
  buildPropertyFieldForest,
  flattenPropertyFieldForest,
  parseSourcePropertyFields
} from './property-field-tree.ts';
import { PropertyFieldVisualsComponent } from './property-field-visuals.ts';

interface NavigationComponent {
  dismissPopover(state: NavigationDocumentState): void;
  documentStates: Map<Document, NavigationDocumentState>;
  findCodeMirrorView(element: Element): EditorView | null;
  highlightVisibleSourceLine(): void;
  observeDocument(doc: Document): void;
  onCodeMirrorScroll(view: EditorView): void;
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

interface PreviewFixture {
  buttons: HTMLButtonElement[];
  codeMirror: EditorView;
  dispatch: ReturnType<typeof vi.fn>;
  input: HTMLInputElement;
  setCursor: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof EditorView.scrollIntoView>;
  source: HTMLElement;
}

let component: NavigationComponent;
let settings: PluginSettings;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn(), writable: true });
  settings = new PluginSettings();
  settings.globalHoverBreadcrumbPopoverTimeoutSeconds = 0.01;
  component = castTo<NavigationComponent>(
    new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
      app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
      pluginSettingsComponent: { settings }
    }))
  );
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
    vi.advanceTimersByTime(11);
    expect(document.querySelector('.np-property-breadcrumb-popover')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([name.length, name.length]);
  });

  it.each(['root', 'child'])('should single-click to the Source %s key end and retain focus after other breadcrumb hovers and timeout', (name) => {
    const text = '---\nroot:\n  child: value\n---';
    const source = document.body.createDiv({ cls: 'markdown-source-view' });
    const content = source.createDiv({ attr: { tabindex: '0' }, cls: 'cm-content' });
    const line = content.createDiv({ cls: 'cm-line' });
    const setCursor = vi.fn();
    const view = castTo<MarkdownView>({
      containerEl: source,
      editor: {
        focus: (): void => {
          content.focus();
        },
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
    expect(setCursor).toHaveBeenLastCalledWith({ ch: name === 'root' ? 4 : 7, line: lineNumber });
    expect(document.activeElement).toBe(content);
    buttons.find((button) => button.textContent !== name)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.activeElement).toBe(content);
    component.schedulePopoverHide(document);
    vi.advanceTimersByTime(11);
    expect(document.querySelector('.np-property-breadcrumb-popover')).toBeNull();
    expect(document.activeElement).toBe(content);
    expect(setCursor).toHaveBeenCalledTimes(1);
  });
});

describe('breadcrumb scroll previews and timeout navigation', () => {
  function openFixture(mode: string): PreviewFixture {
    const text = '---\nroot:\n  child: value\n---';
    const source = document.body.createDiv({ cls: mode === 'reading' ? 'markdown-preview-view' : `markdown-source-view${mode === 'live-preview' ? ' is-live-preview' : ''}` });
    const content = source.createDiv({ cls: 'cm-content' });
    const line = content.createDiv({ cls: 'cm-line' });
    const input = document.body.createEl('input', { value: 'unchanged caret' });
    input.focus();
    input.setSelectionRange(2, 2);
    const snapshot = EditorView.scrollIntoView(0, { y: 'start' });
    const dispatch = vi.fn();
    const setCursor = vi.fn();
    const codeMirror = castTo<EditorView>({
      dispatch,
      dom: content,
      scrollSnapshot: vi.fn(() => snapshot),
      state: EditorState.create({ doc: text })
    });
    if (mode === 'source') {
      component.findCodeMirrorView = (): EditorView => codeMirror;
      const roots = parseSourcePropertyFields(text);
      const current = flattenPropertyFieldForest(roots).at(-1);
      if (current === undefined) {
        throw new Error('Missing Source fixture');
      }
      const view = castTo<MarkdownView>({ containerEl: source, editor: { focus: vi.fn(), getLine: (index: number): string => text.split('\n')[index] ?? '', setCursor } });
      component.showSourceBreadcrumb(document, roots, current, line, view);
    } else {
      const container = source.createDiv({ cls: 'metadata-container' });
      const root = container.createDiv({ cls: 'metadata-property' });
      root.createDiv({ cls: 'metadata-property-key' }).createEl('input', { cls: 'metadata-property-key-input', value: 'root' });
      const child = root.createDiv({ cls: 'metadata-property-value' }).createDiv({ cls: 'metadata-property' });
      child.createDiv({ cls: 'metadata-property-key' }).createEl('input', { cls: 'metadata-property-key-input', value: 'child' });
      const roots = buildPropertyFieldForest(container);
      const nodes = flattenPropertyFieldForest(roots);
      const current = nodes.at(-1);
      if (current === undefined) {
        throw new Error('Missing DOM fixture');
      }
      for (const [index, node] of nodes.entries()) {
        node.keyElement.scrollIntoView = (): void => {
          source.scrollTop = index * 50;
        };
      }
      component.showDomBreadcrumb(document, roots, current, child);
    }
    source.scrollTop = 100;
    return { buttons: [...document.querySelectorAll<HTMLButtonElement>('.np-property-breadcrumb-key')], codeMirror, dispatch, input, setCursor, snapshot, source };
  }

  it.each(['live-preview', 'source', 'reading'].flatMap((mode) => [false, true].flatMap((before) => [false, true].map((after) => ({ after, before, mode })))))('should preview and dismiss in $mode with before=$before after=$after without moving the caret', ({ after, before, mode }) => {
    settings.isPropertyFieldHoverBreadcrumbNavigateBeforeTimeoutEnabled = before;
    settings.isPropertyFieldHoverBreadcrumbNavigateAfterTimeoutEnabled = after;
    const { buttons, dispatch, input, setCursor, snapshot, source } = openFixture(mode);
    buttons[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    if (mode === 'source') {
      expect(dispatch).toHaveBeenCalledTimes(before ? 1 : 0);
      expect(dispatch.mock.calls.every(([transaction]) => !('selection' in transaction))).toBe(true);
    } else {
      expect(source.scrollTop).toBe(before ? 0 : 100);
    }
    component.schedulePopoverHide(document);
    vi.advanceTimersByTime(11);
    expect(document.querySelector('.np-property-breadcrumb-popover')).toBeNull();
    if (mode === 'source') {
      expect(dispatch).toHaveBeenCalledTimes((before ? 1 : 0) + (after || before ? 1 : 0));
      if (before && !after) {
        expect(dispatch).toHaveBeenLastCalledWith({ effects: snapshot });
      } else if (after) {
        expect(dispatch).not.toHaveBeenLastCalledWith({ effects: snapshot });
      }
      expect(setCursor).not.toHaveBeenCalled();
    } else {
      expect(source.scrollTop).toBe(after ? 0 : 100);
    }
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(2);
  });

  it.each(['live-preview', 'source'])('should restore the first scroll position after multiple previews and Escape in %s', (mode) => {
    settings.isPropertyFieldHoverBreadcrumbNavigateAfterTimeoutEnabled = true;
    const { buttons, dispatch, snapshot, source } = openFixture(mode);
    buttons[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    buttons[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    component.schedulePopoverHide(document);
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    vi.advanceTimersByTime(11);
    expect(document.querySelector('.np-property-breadcrumb-popover')).toBeNull();
    if (mode === 'source') {
      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(dispatch).toHaveBeenLastCalledWith({ effects: snapshot });
    } else {
      expect(source.scrollTop).toBe(100);
    }
  });

  it('should keep the Source popover through preview scrolling and cancel deferred navigation after document edits', () => {
    settings.isPropertyFieldHoverBreadcrumbNavigateAfterTimeoutEnabled = true;
    const { buttons, codeMirror, dispatch } = openFixture('source');
    buttons[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    component.onCodeMirrorScroll(codeMirror);
    expect(document.querySelector('.np-property-breadcrumb-popover')).not.toBeNull();
    Object.defineProperty(codeMirror, 'state', { value: EditorState.create({ doc: '---\nother: value\n---' }) });
    component.schedulePopoverHide(document);
    vi.advanceTimersByTime(11);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.np-property-breadcrumb-popover')).toBeNull();
  });

  it('should preview keyboard-focused rows and commit the clicked scroll position', () => {
    const { buttons, source } = openFixture('live-preview');
    buttons[0]?.focus();
    expect(source.scrollTop).toBe(0);
    buttons[0]?.click();
    buttons[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(source.scrollTop).toBe(50);
    component.schedulePopoverHide(document);
    vi.advanceTimersByTime(11);
    expect(source.scrollTop).toBe(0);
  });

  it('should discard deferred navigation when Source changes to Live Preview', () => {
    settings.isPropertyFieldHoverBreadcrumbNavigateBeforeTimeoutEnabled = false;
    settings.isPropertyFieldHoverBreadcrumbNavigateAfterTimeoutEnabled = true;
    const { buttons, dispatch, source } = openFixture('source');
    buttons[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    source.classList.add('is-live-preview');
    component.schedulePopoverHide(document);
    vi.advanceTimersByTime(11);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
