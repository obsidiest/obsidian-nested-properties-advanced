import {
  history,
  redo,
  undo
} from '@codemirror/commands';
import {
  EditorState,
  StateEffect,
  Transaction
} from '@codemirror/state';
import {
  Decoration,
  EditorView
} from '@codemirror/view';
import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PropertyFieldNode } from './property-field-tree.ts';

import { PluginSettings } from './plugin-settings.ts';
import {
  buildRoundedPath,
  computeTextReplacement,
  createCssNumberReader,
  findElementAtClientY,
  flattenVisiblePropertyFieldForest,
  getBreadcrumbKeyboardTarget,
  getPropertyFieldMutationContainers,
  getShownMetadataContainers,
  getShownSourceViews,
  getSourceKeyActivationRects,
  getSourceKeyCharacterRange,
  getThreadDepthColorIndex,
  hideSourceViewOverlay,
  isContainerRenderCurrent,
  isFrontmatterOnlyChange,
  isPointerWithinActivationRegion,
  isPropertyFieldMutation,
  isPropertyVisualStyleMutation,
  isRedoShortcut,
  isSourceEditorMutation,
  isSourceViewModeMutation,
  isUndoShortcut,
  PropertyFieldVisualsComponent,
  removeMetadataContainerVisualArtifacts,
  removeSourceViewVisualArtifacts,
  resolveBreadcrumbActivationScope,
  resolveCodeMirrorDocumentLine,
  resolveCodeMirrorDocumentLineAtPointer,
  resolveCodeMirrorLineElementAtPointer,
  resolveDomBreadcrumbPropertyAtPointer,
  resolveDomPropertyAtPointer,
  resolveSourceBreadcrumbLineAtPointer,
  resolveSourceLine,
  resolveSourceLineElementAtPointer,
  scrollElementWithinContainer
} from './property-field-visuals.ts';
import { sourceFieldHighlightState } from './source-field-highlight.ts';

interface TestActiveField {
  element: HTMLElement;
  kind: string;
}

interface TestDocumentState {
  active: null | TestActiveField;
  bodyStyleObserver: MutationObserver | null;
  cleanups: (() => void)[];
  hideTimer: null;
  hoveredBreadcrumbField: HTMLElement | null;
  hoveredThreadingField: HTMLElement | null;
  lastPropertyEditorView: unknown;
  metadataContainerCleanups: Map<HTMLElement, () => void>;
  mutationObserver: MutationObserver | null;
  popover: HTMLElement | null;
  renderedContainers: Set<HTMLElement>;
  renderedSourceViews: Set<HTMLElement>;
  renderFrame: null;
  renderGeneration: number;
  sourceHighlight: EditorView | null;
  sourceModeObservers: Map<HTMLElement, MutationObserver>;
}

interface TestEditorPosition {
  ch: number;
  line: number;
}

interface TestPointerCoordinates {
  x: number;
  y: number;
}

interface TestPropertyFieldVisualsComponent {
  clearSourceHighlight(ownerDocument: Document, state: TestDocumentState): void;
  codeMirrorViews: Set<unknown>;
  documentStates: Map<Document, TestDocumentState>;
  findCodeMirrorView(element: Element): unknown;
  findMarkdownView(ownerDocument: Document, target: EventTarget | null): unknown;
  highlightSourceLine(ownerDocument: Document, line: HTMLElement): void;
  observeDocument(ownerDocument: Document): void;
  onCodeMirrorUpdate(update: unknown): void;
  onFocusIn(ownerDocument: Document, event: FocusEvent): void;
  onFocusOut(ownerDocument: Document, event: FocusEvent): void;
  onKeyDown(ownerDocument: Document, event: KeyboardEvent): void;
  onPointerMove(ownerDocument: Document, event: PointerEvent): void;
  onPropertyEditorChanged(ownerDocument: Document, event: Event): void;
  renderDocument(ownerDocument: Document): void;
  syncMetadataContainerListeners(ownerDocument: Document, state: TestDocumentState, containers: readonly HTMLElement[]): void;
}

type VisualMutation = Parameters<typeof isPropertyFieldMutation>[0];

function createAttributeMutation(target: Element, attributeName: 'class' | 'style', oldValue: string): VisualMutation {
  return {
    addedNodes: [],
    attributeName,
    oldValue,
    removedNodes: [],
    target
  };
}

function createMutation(target: Node, addedNodes: Node[] = [], removedNodes: Node[] = []): VisualMutation {
  return {
    addedNodes,
    attributeName: null,
    oldValue: null,
    removedNodes,
    target
  };
}

describe('buildRoundedPath', () => {
  it('should produce a rounded vertical-to-horizontal connector', () => {
    expect(buildRoundedPath({ endX: 40, endY: 30, radius: 6, startX: 10, startY: 0 })).toBe('M 10 0 V 24 Q 10 30 16 30 H 40');
  });

  it('should clamp radius to the available distance', () => {
    expect(buildRoundedPath({ endX: 13, endY: 2, radius: 20, startX: 10, startY: 0 })).toBe('M 10 0 V 0 Q 10 2 12 2 H 13');
  });

  it('should use a straight connector for a zero radius or level endpoints', () => {
    expect(buildRoundedPath({ endX: 40, endY: 30, radius: 0, startX: 10, startY: 0 })).toBe('M 10 0 V 30 H 40');
    expect(buildRoundedPath({ endX: 40, endY: 30, radius: 6, startX: 10, startY: 30 })).toBe('M 10 30 V 30 H 40');
  });
});

describe('scrollElementWithinContainer', () => {
  it('should scroll only the breadcrumb tree and never an ancestor editor', () => {
    const tree = document.body.createDiv();
    const row = tree.createDiv();
    tree.scrollTop = 40;
    vi.spyOn(tree, 'getBoundingClientRect').mockReturnValue({ bottom: 200, top: 100 } as DOMRect);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ bottom: 260, top: 220 } as DOMRect);

    scrollElementWithinContainer(tree, row);

    expect(tree.scrollTop).toBe(100);
    tree.remove();
  });
});

describe('getBreadcrumbKeyboardTarget', () => {
  it('should move within the available breadcrumb rows', () => {
    expect(getBreadcrumbKeyboardTarget('ArrowDown', 1, 4)).toBe(2);
    expect(getBreadcrumbKeyboardTarget('ArrowDown', 3, 4)).toBe(3);
    expect(getBreadcrumbKeyboardTarget('ArrowUp', 1, 4)).toBe(0);
    expect(getBreadcrumbKeyboardTarget('ArrowUp', 0, 4)).toBe(0);
  });

  it('should support first and last row shortcuts', () => {
    expect(getBreadcrumbKeyboardTarget('Home', 2, 4)).toBe(0);
    expect(getBreadcrumbKeyboardTarget('End', 1, 4)).toBe(3);
  });

  it('should ignore unsupported keys and empty breadcrumbs', () => {
    expect(getBreadcrumbKeyboardTarget('Enter', 1, 4)).toBeNull();
    expect(getBreadcrumbKeyboardTarget('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('getThreadDepthColorIndex', () => {
  it('should assign colors by depth and keep the eighth color for deeper fields', () => {
    expect(getThreadDepthColorIndex(0)).toBe(1);
    expect(getThreadDepthColorIndex(6)).toBe(7);
    expect(getThreadDepthColorIndex(7)).toBe(8);
    expect(getThreadDepthColorIndex(20)).toBe(8);
    expect(getThreadDepthColorIndex(-2)).toBe(1);
  });
});

describe('property field visual render guards', () => {
  it('should retain the Source marker when CodeMirror redraws its own line attributes', () => {
    const instance = new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
      app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
      pluginSettingsComponent: { settings: new PluginSettings() }
    }));
    const component = castTo<TestPropertyFieldVisualsComponent>(instance);
    const source = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const view = new EditorView({ doc: 'root: value\nnext: value', extensions: [instance.createEditorExtension()], parent: source });
    try {
      const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
      if (line === null) {
        throw new Error('Expected a real CodeMirror line');
      }
      component.highlightSourceLine(document, line);
      expect(line.classList.contains('np-property-field-source-highlight')).toBe(true);
      // Native editor reconfiguration replaces line attributes. External classList
      // Writes are discarded; only decorations participate in CodeMirror's redraw.
      const nativeDecoration = Decoration.set([Decoration.line({ class: 'native-line-attribute' }).range(0)]);
      view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(nativeDecoration)) });
      const rendered = view.contentDOM.querySelector<HTMLElement>('.cm-line');
      expect(rendered?.classList.contains('native-line-attribute')).toBe(true);
      expect(rendered?.classList.contains('np-property-field-source-highlight')).toBe(true);
      view.dispatch({ changes: { from: 0, insert: 'before: value\n' } });
      expect(view.contentDOM.querySelector('.np-property-field-source-highlight')?.textContent).toBe('root: value');
      const state = component.documentStates.get(document);
      if (state === undefined) {
        throw new Error('Expected the registered editor document');
      }
      component.clearSourceHighlight(document, state);
      expect(view.contentDOM.querySelector('.np-property-field-source-highlight')).toBeNull();
    } finally {
      view.destroy();
      instance.onunload();
      source.remove();
    }
  });

  it('should not let a previous document remove artifacts from an adopted editor', () => {
    const component = castTo<TestPropertyFieldVisualsComponent>(
      new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
        app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
        pluginSettingsComponent: { settings: new PluginSettings() }
      }))
    );
    component.observeDocument(document);
    const state = component.documentStates.get(document);
    if (state === undefined) {
      throw new Error('Expected document state');
    }
    const source = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const metadata = source.createDiv({ cls: 'metadata-container' });
    const metadataOverlay = metadata.createDiv({ cls: 'np-property-tree-overlay' });
    const sourceOverlay = source.createDiv({ cls: 'np-property-source-overlay' });
    const line = source.createDiv({ cls: 'cm-line np-property-field-source-highlight', text: 'root: value' });
    const frame = document.body.createEl('iframe');
    frame.contentDocument?.body.append(source);
    expect(source.ownerDocument).not.toBe(document);
    state.renderedContainers.add(metadata);
    state.renderedSourceViews.add(source);
    state.sourceHighlight = castTo<EditorView>({ dom: source });
    state.active = castTo<TestActiveField>({ kind: 'source', view: { containerEl: source } });

    // A queued render for the old document can run after the destination has painted.
    component.renderDocument(document);

    expect(source.contains(sourceOverlay)).toBe(true);
    expect(metadata.contains(metadataOverlay)).toBe(true);
    expect(line.classList.contains('np-property-field-source-highlight')).toBe(true);
    expect(state.renderedSourceViews.size).toBe(0);
    expect(state.renderedContainers.size).toBe(0);
    expect(state.active).toBeNull();
    expect(state.sourceHighlight).toBeNull();
    state.mutationObserver?.disconnect();
    state.bodyStyleObserver?.disconnect();
    for (const cleanup of state.cleanups) {
      cleanup();
    }
    frame.remove();
    component.documentStates.delete(document);
  });

  it('should prioritize full-field then full-key then toggle-only breadcrumb activation', () => {
    expect(resolveBreadcrumbActivationScope(true, true)).toBe('field');
    expect(resolveBreadcrumbActivationScope(false, true)).toBe('key');
    expect(resolveBreadcrumbActivationScope(false, false)).toBe('toggle');
  });

  it.each([false, true])('should activate from the owning leaf with an adopted pointer target=%s', (isAdopted) => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const settings = new PluginSettings();
    settings.isFullWidthPropertyFieldHoverActivationEnabled = true;
    settings.isPropertyFieldThreadingEnabled = true;
    const component = castTo<TestPropertyFieldVisualsComponent>(
      new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
        app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
        pluginSettingsComponent: { settings }
      }))
    );
    component.observeDocument(document);
    const state = component.documentStates.get(document);
    expect(state).toBeDefined();
    if (state === undefined) {
      throw new Error('Expected document state');
    }
    const leaf = document.body.createDiv({ cls: 'workspace-leaf-content' });
    const sourceView = leaf.createDiv({ cls: ['markdown-source-view', 'is-live-preview'] });
    const container = sourceView.createDiv({ cls: 'metadata-container' });
    const property = container.createDiv({ cls: 'metadata-property' });
    const key = property.createDiv({ cls: 'metadata-property-key', text: 'Key' });
    const value = property.createDiv({ cls: 'metadata-property-value', text: 'Value' });
    const frame = document.body.createEl('iframe');
    const foreignSurface = frame.contentDocument?.createElement('div');
    if (foreignSurface === undefined) {
      throw new Error('Expected another DOM realm');
    }
    sourceView.append(foreignSurface);
    expect(foreignSurface.ownerDocument).toBe(document);
    // Check native prototype identity; Obsidian's instanceOf helper intentionally hides this distinction.
    // Compare before invoking the matcher: DOM prototypes themselves have no Node internal slots.
    const isOwnerPrototype = Object.getPrototypeOf(foreignSurface) === window.HTMLDivElement.prototype;
    expect(isOwnerPrototype).toBe(false);
    vi.spyOn(container, 'isShown').mockReturnValue(true);
    vi.spyOn(sourceView, 'getBoundingClientRect').mockReturnValue({ bottom: 500, height: 500, left: 0, right: 1800, top: 0, width: 1800 } as DOMRect);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ bottom: 100, height: 100, left: 100, right: 900, top: 0, width: 800 } as DOMRect);
    vi.spyOn(key, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 100, right: 300, top: 20, width: 200 } as DOMRect);
    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 300, right: 900, top: 20, width: 600 } as DOMRect);

    const pointerTarget = isAdopted ? foreignSurface : sourceView;
    pointerTarget.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 1600, clientY: 30 }));

    expect(state.active).toMatchObject({ element: property, kind: 'dom' });
    expect(state.hoveredBreadcrumbField).toBe(property);
    const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => sourceView });
    // The browser's painted surface remains authoritative when pointer capture sends
    // An event to a different DOM subtree.
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 1600, clientY: 30 }));
    expect(state.hoveredBreadcrumbField).toBe(property);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body });
    key.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 30 }));
    expect(state.hoveredBreadcrumbField).toBeNull();
    if (originalHitTest === undefined) {
      Reflect.deleteProperty(document, 'elementFromPoint');
    } else {
      Object.defineProperty(document, 'elementFromPoint', originalHitTest);
    }
    state.mutationObserver?.disconnect();
    state.bodyStyleObserver?.disconnect();
    for (const cleanup of state.cleanups) {
      cleanup();
    }
    state.popover?.remove();
    leaf.remove();
    frame.remove();
    component.documentStates.delete(document);
    Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
  });

  it('should resolve the full horizontal field from its vertical row band', () => {
    const first = document.body.createDiv();
    const second = document.body.createDiv();
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ bottom: 30, height: 20, top: 10 } as DOMRect);
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ bottom: 60, height: 20, top: 40 } as DOMRect);

    expect(findElementAtClientY([first, second], 20)).toBe(first);
    expect(findElementAtClientY([first, second], 50)).toBe(second);
    expect(findElementAtClientY([first, second], 35)).toBeNull();
    first.remove();
    second.remove();
  });

  it('should use separate visual bands for a wrapped Source key and exclude its wrapped value', () => {
    const line = document.body.createDiv({ cls: 'cm-line', text: 'Wrapped property name: value' });
    const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(100, 22, 290, 16), new DOMRect(100, 42, 40, 16)]
    });
    vi.spyOn(line, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 20, 300, 60));
    const view = {
      coordsAtPos: (): Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'> => ({ bottom: 60, left: 140, right: 140, top: 40 }),
      defaultLineHeight: 20,
      state: EditorState.create({ doc: '---\nWrapped property name: value\n---' })
    };
    const region = { field: line.getBoundingClientRect(), key: null, keyFragments: getSourceKeyActivationRects(view, line, 1), toggles: [] };
    expect(isPointerWithinActivationRegion(region, 'key', 380, 30)).toBe(true);
    expect(isPointerWithinActivationRegion(region, 'key', 120, 50)).toBe(true);
    expect(isPointerWithinActivationRegion(region, 'key', 200, 50)).toBe(false);
    expect(isPointerWithinActivationRegion(region, 'key', 120, 70)).toBe(false);
    expect(isPointerWithinActivationRegion(region, 'field', 380, 70)).toBe(true);
    if (originalRects === undefined) {
      Reflect.deleteProperty(Range.prototype, 'getClientRects');
    } else {
      Object.defineProperty(Range.prototype, 'getClientRects', originalRects);
    }
    line.remove();
  });

  it('should resolve a rendered property from its key, value, or blank row width', () => {
    const container = document.body.createDiv({ cls: 'metadata-container' });
    const property = container.createDiv({ cls: 'metadata-property' });
    const key = property.createDiv({ cls: 'metadata-property-key', text: 'Key' });
    const value = property.createDiv({ cls: 'metadata-property-value', text: 'Value' });
    vi.spyOn(container, 'isShown').mockReturnValue(true);
    vi.spyOn(key, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 250, top: 20, width: 240 } as DOMRect);
    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 250, right: 900, top: 20, width: 650 } as DOMRect);

    expect(resolveDomPropertyAtPointer(key, 20, 30)).toBe(property);
    expect(resolveDomPropertyAtPointer(value, 500, 30)).toBe(property);
    expect(resolveDomPropertyAtPointer(container, 800, 30)).toBe(property);
    expect(resolveDomPropertyAtPointer(container, 800, 50)).toBeNull();
    container.remove();
  });

  it('should discard a same-size hit snapshot after Obsidian replaces its property row', () => {
    const container = document.body.createDiv({ cls: 'metadata-container' });
    const firstProperty = container.createDiv({ cls: 'metadata-property' });
    const firstKey = firstProperty.createDiv({ cls: 'metadata-property-key', text: 'First' });
    vi.spyOn(container, 'isShown').mockReturnValue(true);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ bottom: 100, height: 100, left: 0, right: 800, top: 0, width: 800 } as DOMRect);
    vi.spyOn(firstKey, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 0, right: 200, top: 20, width: 200 } as DOMRect);

    expect(resolveDomPropertyAtPointer(container, 700, 30)).toBe(firstProperty);
    firstProperty.remove();
    const secondProperty = container.createDiv({ cls: 'metadata-property' });
    const secondKey = secondProperty.createDiv({ cls: 'metadata-property-key', text: 'Second' });
    vi.spyOn(secondKey, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 0, right: 200, top: 20, width: 200 } as DOMRect);

    expect(resolveDomPropertyAtPointer(container, 700, 30)).toBe(secondProperty);
    container.remove();
  });

  it('should activate both a Live Preview breadcrumb and threading across the source-view width', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const settings = new PluginSettings();
    settings.isFullWidthPropertyFieldHoverActivationEnabled = true;
    settings.isPropertyFieldThreadingEnabled = true;
    const component = castTo<TestPropertyFieldVisualsComponent>(
      new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
        app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
        pluginSettingsComponent: { settings }
      }))
    );
    const state: TestDocumentState = {
      active: null,
      bodyStyleObserver: null,
      cleanups: [],
      hideTimer: null,
      hoveredBreadcrumbField: null,
      hoveredThreadingField: null,
      lastPropertyEditorView: null,
      metadataContainerCleanups: new Map(),
      mutationObserver: null,
      popover: null,
      renderedContainers: new Set(),
      renderedSourceViews: new Set(),
      renderFrame: null,
      renderGeneration: 0,
      sourceHighlight: null,
      sourceModeObservers: new Map()
    };
    component.documentStates.set(document, state);
    const sourceView = document.body.createDiv({ cls: ['markdown-source-view', 'is-live-preview'] });
    const container = sourceView.createDiv({ cls: 'metadata-container' });
    const property = container.createDiv({ cls: 'metadata-property' });
    const key = property.createDiv({ cls: 'metadata-property-key', text: 'Key' });
    const value = property.createDiv({ cls: 'metadata-property-value', text: 'Value' });
    vi.spyOn(container, 'isShown').mockReturnValue(true);
    vi.spyOn(sourceView, 'getBoundingClientRect').mockReturnValue({ bottom: 500, height: 500, left: 0, right: 1800, top: 0, width: 1800 } as DOMRect);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ bottom: 100, height: 100, left: 100, right: 900, top: 0, width: 800 } as DOMRect);
    vi.spyOn(key, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 300, top: 20, width: 290 } as DOMRect);
    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 300, right: 900, top: 20, width: 600 } as DOMRect);

    component.syncMetadataContainerListeners(document, state, [container]);
    expect(state.metadataContainerCleanups.has(container)).toBe(true);
    component.onPointerMove(document, castTo<PointerEvent>({ clientX: 1600, clientY: 30, target: sourceView }));

    expect(state.active).toMatchObject({ element: property, kind: 'dom' });
    expect(state.hoveredBreadcrumbField).toBe(property);
    expect(state.popover?.classList.contains('np-property-breadcrumb-popover')).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
    state.popover?.remove();
    sourceView.remove();
    component.documentStates.delete(document);
    Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
  });

  it('should keep key-only property rows pointer-safe when Obsidian has not mounted a value yet', () => {
    const container = document.body.createDiv({ cls: 'metadata-container' });
    const property = container.createDiv({ cls: 'metadata-property' });
    const key = property.createDiv({ cls: 'metadata-property-key', text: 'Key' });
    vi.spyOn(key, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 250, top: 20, width: 240 } as DOMRect);

    expect(resolveDomPropertyAtPointer(key, 20, 30)).toBe(property);
    container.remove();
  });

  it('should activate Source breadcrumb and threading for root and flattened properties across the source-view width', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const settings = new PluginSettings();
    settings.isFullWidthPropertyFieldHoverActivationEnabled = true;
    settings.isPropertyFieldThreadingEnabled = true;
    const component = castTo<TestPropertyFieldVisualsComponent>(
      new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
        app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
        pluginSettingsComponent: { settings }
      }))
    );
    component.observeDocument(document);
    const state = component.documentStates.get(document);
    expect(state).toBeDefined();
    if (state === undefined) {
      throw new Error('Expected document state');
    }
    const sourceView = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const content = sourceView.createDiv({ cls: 'cm-content' });
    const rootLine = content.createDiv({ cls: 'cm-line', text: 'root: value' });
    const flattenedLine = content.createDiv({ cls: 'cm-line', text: 'root.child: value' });
    vi.spyOn(sourceView, 'getBoundingClientRect').mockReturnValue({ bottom: 500, height: 500, left: 0, right: 1000, top: 0, width: 1000 } as DOMRect);
    vi.spyOn(rootLine, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 20, right: 900, top: 20, width: 880 } as DOMRect);
    vi.spyOn(flattenedLine, 'getBoundingClientRect').mockReturnValue({ bottom: 70, height: 20, left: 20, right: 900, top: 50, width: 880 } as DOMRect);
    const source = '---\nroot: value\nroot.child: value\n---';
    const view = {
      containerEl: sourceView,
      editor: {
        getCursor: (): TestEditorPosition => ({ ch: 0, line: 1 }),
        getValue: (): string => source
      }
    };
    component.findMarkdownView = (): unknown => view;
    const codeMirrorView = {
      contentDOM: content,
      coordsAtPos: (): DOMRect => ({ bottom: 40, height: 20, left: 120, right: 120, top: 20, width: 0 } as DOMRect),
      dispatch: (spec: Parameters<EditorState['update']>[0]): void => {
        codeMirrorView.state = codeMirrorView.state.update(spec).state;
      },
      dom: content,
      posAtCoords: ({ y }: TestPointerCoordinates): number => y < 50 ? source.indexOf('root:') : source.indexOf('root.child'),
      posAtDOM: (lineElement: HTMLElement): number => lineElement === rootLine ? source.indexOf('root:') : source.indexOf('root.child'),
      state: EditorState.create({ doc: source, extensions: [sourceFieldHighlightState] })
    };
    component.codeMirrorViews.add(codeMirrorView);
    sourceView.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 980, clientY: 30 }));

    expect(state.active).toMatchObject({ kind: 'source', line: 1 });
    expect(state.hoveredBreadcrumbField).toBe(rootLine);
    expect(state.hoveredThreadingField).toBe(rootLine);
    expect(state.popover?.classList.contains('np-property-breadcrumb-popover')).toBe(true);
    expect(codeMirrorView.state.field(sourceFieldHighlightState)).toBe(source.indexOf('root:'));

    sourceView.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 980, clientY: 60 }));
    expect(state.active).toMatchObject({ kind: 'source', line: 2 });
    expect(state.hoveredBreadcrumbField).toBe(flattenedLine);
    expect(state.hoveredThreadingField).toBe(flattenedLine);
    expect(codeMirrorView.state.field(sourceFieldHighlightState)).toBe(source.indexOf('root.child'));
    expect(scrollIntoView).not.toHaveBeenCalled();
    state.mutationObserver?.disconnect();
    state.bodyStyleObserver?.disconnect();
    for (const cleanup of state.cleanups) {
      cleanup();
    }
    state.popover?.remove();
    sourceView.remove();
    component.codeMirrorViews.clear();
    component.documentStates.delete(document);
    Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
  });

  it('should select the primary Markdown editor when a nested CodeMirror view registered first', () => {
    const component = castTo<TestPropertyFieldVisualsComponent>(
      new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
        app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
        pluginSettingsComponent: { settings: new PluginSettings() }
      }))
    );
    const sourceView = document.body.createDiv({ cls: ['markdown-source-view', 'mod-cm6'] });
    const primaryEditor = sourceView.createDiv({ cls: 'cm-editor' });
    const primaryContent = primaryEditor.createDiv({ cls: 'cm-content' });
    const sourceLine = primaryContent.createDiv({ cls: 'cm-line', text: 'root: value' });
    const metadataContainer = primaryContent.createDiv({ cls: 'metadata-container' });
    const nestedEditor = metadataContainer.createDiv({ cls: 'cm-editor' });
    const nestedContent = nestedEditor.createDiv({ cls: 'cm-content' });
    const nestedView = { contentDOM: nestedContent, dom: nestedEditor };
    const primaryView = { contentDOM: primaryContent, dom: primaryEditor };
    component.codeMirrorViews.add(nestedView);
    component.codeMirrorViews.add(primaryView);

    expect(component.findCodeMirrorView(sourceView)).toBe(primaryView);
    expect(component.findCodeMirrorView(sourceLine)).toBe(primaryView);
    expect(component.findCodeMirrorView(metadataContainer)).toBe(primaryView);

    component.codeMirrorViews.clear();
    sourceView.remove();
  });

  it('should apply field, key, and icon activation scopes without changing full-row resolution', () => {
    const container = document.body.createDiv({ cls: 'metadata-container' });
    const property = container.createDiv({ cls: 'metadata-property' });
    const key = property.createDiv({ cls: 'metadata-property-key' });
    const icon = key.createDiv({ cls: 'metadata-property-icon' });
    const iconSvg = icon.createSvg('svg');
    const collapse = key.createDiv({ cls: 'nested-properties-collapse-btn' });
    const keyInput = key.createEl('input', { cls: 'metadata-property-key-input' });
    const value = property.createDiv({ cls: 'metadata-property-value' });
    vi.spyOn(key, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 900, top: 20, width: 890 } as DOMRect);
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 250, top: 20, width: 240 } as DOMRect);
    vi.spyOn(iconSvg, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 } as DOMRect);
    vi.spyOn(collapse, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 } as DOMRect);
    vi.spyOn(keyInput, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 30, right: 250, top: 20, width: 220 } as DOMRect);
    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 250, right: 900, top: 20, width: 650 } as DOMRect);

    expect(resolveDomBreadcrumbPropertyAtPointer(value, 800, 30, 'field')).toBe(property);
    expect(resolveDomBreadcrumbPropertyAtPointer(value, 200, 30, 'key')).toBe(property);
    expect(resolveDomBreadcrumbPropertyAtPointer(key, 300, 30, 'key')).toBeNull();
    expect(resolveDomBreadcrumbPropertyAtPointer(icon, 20, 30, 'toggle')).toBe(property);
    expect(resolveDomBreadcrumbPropertyAtPointer(icon, 100, 30, 'toggle')).toBeNull();
    expect(resolveDomBreadcrumbPropertyAtPointer(collapse, 20, 30, 'toggle')).toBe(property);
    expect(resolveDomBreadcrumbPropertyAtPointer(container, 20, 30, 'toggle')).toBe(property);
    expect(resolveDomBreadcrumbPropertyAtPointer(key, 20, 30, 'toggle')).toBe(property);
    expect(resolveDomBreadcrumbPropertyAtPointer(key, 100, 30, 'toggle')).toBeNull();
    expect(resolveDomPropertyAtPointer(value, 800, 30)).toBe(property);
    container.remove();
  });

  it('should deactivate key-only and icon-only breadcrumbs as soon as their activation target is left', () => {
    vi.useFakeTimers();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const settings = new PluginSettings();
    settings.isFullWidthPropertyFieldHoverActivationEnabled = false;
    settings.isFullWidthPropertyKeyHoverActivationEnabled = true;
    const component = castTo<TestPropertyFieldVisualsComponent>(
      new PropertyFieldVisualsComponent(castTo<ConstructorParameters<typeof PropertyFieldVisualsComponent>[0]>({
        app: { workspace: { iterateAllLeaves: vi.fn(), layoutReady: false } },
        pluginSettingsComponent: { settings }
      }))
    );
    component.observeDocument(document);
    const state = component.documentStates.get(document);
    expect(state).toBeDefined();
    if (state === undefined) {
      throw new Error('Expected document state');
    }
    const sourceView = document.body.createDiv({ cls: ['markdown-source-view', 'is-live-preview'] });
    const container = sourceView.createDiv({ cls: 'metadata-container' });
    const property = container.createDiv({ cls: 'metadata-property' });
    const key = property.createDiv({ cls: 'metadata-property-key', text: 'Key' });
    const icon = key.createDiv({ cls: 'metadata-property-icon' });
    const iconSvg = icon.createSvg('svg');
    const keyInput = key.createEl('input', { cls: 'metadata-property-key-input' });
    const value = property.createDiv({ cls: 'metadata-property-value', text: 'Value' });
    vi.spyOn(sourceView, 'getBoundingClientRect').mockReturnValue({ bottom: 500, height: 500, left: 0, right: 1800, top: 0, width: 1800 } as DOMRect);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ bottom: 100, height: 100, left: 100, right: 900, top: 0, width: 800 } as DOMRect);
    vi.spyOn(key, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 900, top: 20, width: 890 } as DOMRect);
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 250, top: 20, width: 240 } as DOMRect);
    vi.spyOn(iconSvg, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 } as DOMRect);
    vi.spyOn(keyInput, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 30, right: 250, top: 20, width: 220 } as DOMRect);
    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 250, right: 900, top: 20, width: 650 } as DOMRect);

    key.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 30 }));
    expect(state.hoveredBreadcrumbField).toBe(property);
    sourceView.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 800, clientY: 30 }));
    expect(state.hoveredBreadcrumbField).toBeNull();
    expect(state.popover).toBeNull();
    vi.advanceTimersByTime(121);
    expect(state.popover).toBeNull();

    settings.isFullWidthPropertyKeyHoverActivationEnabled = false;
    // Obsidian themes can make the SVG itself pointer-transparent, leaving the key as the event target.
    key.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 30 }));
    expect(state.hoveredBreadcrumbField).toBe(property);
    state.popover?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 1000, clientY: 200 }));
    expect(state.hoveredBreadcrumbField).toBeNull();
    expect(state.popover).not.toBeNull();
    key.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 30 }));
    expect(state.hoveredBreadcrumbField).toBeNull();
    expect(state.popover).toBeNull();
    vi.advanceTimersByTime(121);
    expect(state.popover).toBeNull();

    state.mutationObserver?.disconnect();
    state.bodyStyleObserver?.disconnect();
    for (const cleanup of state.cleanups) {
      cleanup();
    }
    state.popover?.remove();
    sourceView.remove();
    component.documentStates.delete(document);
    Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
    vi.useRealTimers();
  });

  it('should resolve a Source-mode property line across its full editor width', () => {
    const sourceView = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const line = sourceView.createDiv({ cls: 'cm-line', text: 'root: value' });
    vi.spyOn(line, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, top: 20 } as DOMRect);

    expect(resolveSourceLineElementAtPointer(line, 40, 30)).toBe(line);
    expect(resolveSourceLineElementAtPointer(sourceView, 500, 30)).toBe(line);
    expect(resolveSourceLineElementAtPointer(sourceView, 500, 50)).toBeNull();
    expect(resolveSourceLineElementAtPointer(document.body, 500, 30)).toBeNull();
    sourceView.remove();
  });

  it('should identify Source-mode YAML key character ranges', () => {
    expect(getSourceKeyCharacterRange('  root: value')).toEqual({ end: 7, start: 2 });
    expect(getSourceKeyCharacterRange('  - name: Ada')).toEqual({ end: 9, start: 4 });
    expect(getSourceKeyCharacterRange('  - scalar')).toEqual({ end: 3, start: 2 });
    expect(getSourceKeyCharacterRange('  "quoted:key": value')).toEqual({ end: 15, start: 2 });
    expect(getSourceKeyCharacterRange('flow[key:part]: value')).toEqual({ end: 15, start: 0 });
    expect(getSourceKeyCharacterRange('not a mapping')).toBeNull();
  });

  it('should apply full-field, key-range, and fold-toggle Source activation scopes', () => {
    const sourceView = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const content = sourceView.createDiv({ cls: 'cm-content' });
    const line = content.createDiv({ cls: 'cm-line', text: 'root: value' });
    const collapseIndicator = line.createDiv({ cls: 'collapse-indicator' });
    const foldGutter = sourceView.createDiv({ cls: 'cm-foldGutter' });
    const foldToggle = foldGutter.createDiv({ cls: 'cm-gutterElement', text: '⌄' });
    const emptyGutter = foldGutter.createDiv({ cls: 'cm-gutterElement' });
    vi.spyOn(line, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 800, top: 20, width: 790 } as DOMRect);
    vi.spyOn(collapseIndicator, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 } as DOMRect);
    vi.spyOn(foldToggle, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, left: 490, right: 510, top: 20, width: 20 } as DOMRect);
    const createRange = vi.spyOn(document, 'createRange').mockReturnValue(castTo<Range>({
      getBoundingClientRect: () => ({ left: 10, right: 70, width: 60 }),
      getClientRects: () => [],
      setEnd: vi.fn(),
      setStart: vi.fn()
    }));

    expect(resolveSourceBreadcrumbLineAtPointer(sourceView, 500, 30, 'field')).toBe(line);
    expect(resolveSourceBreadcrumbLineAtPointer(line, 40, 30, 'key')).toBe(line);
    expect(resolveSourceBreadcrumbLineAtPointer(line, 90, 30, 'key')).toBeNull();
    expect(resolveSourceBreadcrumbLineAtPointer(foldToggle, 500, 30, 'toggle')).toBe(line);
    expect(resolveSourceBreadcrumbLineAtPointer(emptyGutter, 500, 30, 'toggle')).toBeNull();
    expect(resolveSourceBreadcrumbLineAtPointer(line, 20, 30, 'toggle')).toBe(line);
    expect(resolveSourceBreadcrumbLineAtPointer(line, 90, 30, 'toggle')).toBeNull();
    createRange.mockRestore();
    sourceView.remove();
  });

  it('should resolve only lines owned by the active CodeMirror viewport', () => {
    const sourceView = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const content = sourceView.createDiv({ cls: 'cm-content' });
    const first = content.createDiv({ cls: 'cm-line', text: 'root: value' });
    const stale = sourceView.createDiv({ cls: 'cm-line', text: 'stale: value' });
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, top: 20 } as DOMRect);
    vi.spyOn(stale, 'getBoundingClientRect').mockReturnValue({ bottom: 40, height: 20, top: 20 } as DOMRect);

    expect(resolveCodeMirrorLineElementAtPointer(castTo<Parameters<typeof resolveCodeMirrorLineElementAtPointer>[0]>({ contentDOM: content }), sourceView, 30)).toBe(first);
    expect(resolveCodeMirrorLineElementAtPointer(castTo<Parameters<typeof resolveCodeMirrorLineElementAtPointer>[0]>({ contentDOM: content }), stale, 30)).toBe(first);
    sourceView.remove();
  });

  it('should recognize only the Windows Ctrl+Y redo shortcut', () => {
    expect(isRedoShortcut({ altKey: false, ctrlKey: true, key: 'y', metaKey: false, shiftKey: false })).toBe(true);
    expect(isRedoShortcut({ altKey: false, ctrlKey: true, key: 'Y', metaKey: false, shiftKey: false })).toBe(true);
    expect(isRedoShortcut({ altKey: false, ctrlKey: true, key: 'y', metaKey: false, shiftKey: true })).toBe(false);
    expect(isRedoShortcut({ altKey: false, ctrlKey: false, key: 'y', metaKey: true, shiftKey: false })).toBe(false);
  });

  it('should recognize only the Windows Ctrl+Z undo shortcut', () => {
    expect(isUndoShortcut({ altKey: false, ctrlKey: true, key: 'z', metaKey: false, shiftKey: false })).toBe(true);
    expect(isUndoShortcut({ altKey: false, ctrlKey: true, key: 'Z', metaKey: false, shiftKey: false })).toBe(true);
    expect(isUndoShortcut({ altKey: false, ctrlKey: true, key: 'z', metaKey: false, shiftKey: true })).toBe(false);
    expect(isUndoShortcut({ altKey: false, ctrlKey: false, key: 'z', metaKey: true, shiftKey: false })).toBe(false);
  });

  it('should remove Source overlays while leaving CodeMirror line attributes to its decoration state', () => {
    const sourceView = document.body.createDiv({ cls: ['markdown-source-view', 'np-property-source-overlay-host'] });
    const sourceOverlay = sourceView.createSvg('svg', { cls: 'np-property-source-overlay' });
    const sourceLine = sourceView.createDiv({ cls: 'np-property-field-source-highlight' });
    const metadata = sourceView.createDiv({ cls: 'metadata-container' });
    const metadataOverlay = metadata.createSvg('svg', { cls: 'np-property-tree-overlay' });

    hideSourceViewOverlay(sourceView);
    expect(sourceOverlay.classList.contains('np-property-source-overlay-hidden')).toBe(true);
    removeSourceViewVisualArtifacts(sourceView);
    expect(sourceOverlay.isConnected).toBe(false);
    expect(sourceLine.classList.contains('np-property-field-source-highlight')).toBe(true);
    expect(sourceView.classList.contains('np-property-source-overlay-host')).toBe(false);
    expect(metadataOverlay.isConnected).toBe(true);

    const node = metadata.createDiv({ cls: ['metadata-property', 'np-property-tree-node', 'np-property-field-active'] });
    node.setCssProps({ '--np-property-depth': '2' });
    removeMetadataContainerVisualArtifacts(metadata);
    expect(metadataOverlay.isConnected).toBe(false);
    expect(node.classList.contains('np-property-tree-node')).toBe(false);
    expect(node.classList.contains('np-property-field-active')).toBe(false);
    expect(node.style.getPropertyValue('--np-property-depth')).toBe('');
    sourceView.remove();
  });

  it('should compute the exact document replacement for a captured Properties edit', () => {
    const before = '---\nroot: before\n---';
    expect(computeTextReplacement(before, '---\nroot: after\n---')).toEqual({ end: 16, replacement: 'after', start: 10 });
    expect(computeTextReplacement(before, before)).toBeNull();
  });

  it('uses native history when a Live Preview filter rejects ordinary frontmatter replay', () => {
    const before = '---\nroot: before\n---\nBody';
    const after = '---\nroot: after\n---\nBody';
    let state = EditorState.create({
      doc: before,
      extensions: [
        history(),
        EditorState.transactionFilter.of((transaction) => transaction.docChanged && !transaction.isUserEvent('set') ? [] : transaction)
      ]
    });
    state = state.update({ changes: { from: 10, insert: 'after', to: 16 }, userEvent: 'set' }).state;
    expect(state.doc.toString()).toBe(after);
    const rejectedReplay = state.update({
      annotations: Transaction.addToHistory.of(false),
      changes: { from: 10, insert: 'before', to: 15 },
      scrollIntoView: false
    });
    expect(rejectedReplay.docChanged).toBe(false);

    function dispatch(transaction: Transaction): void {
      expect(isFrontmatterOnlyChange(transaction)).toBe(true);
      state = transaction.state;
    }
    expect(undo({ dispatch, state })).toBe(true);
    expect(state.doc.toString()).toBe(before);
    expect(redo({ dispatch, state })).toBe(true);
    expect(state.doc.toString()).toBe(after);
  });

  it('limits history scroll suppression to changes within frontmatter, leaving body history native', () => {
    const state = EditorState.create({ doc: '---\nroot: before\n---\nBody' });
    expect(isFrontmatterOnlyChange(state.update({ changes: { from: 10, insert: 'after', to: 16 } }))).toBe(true);
    expect(isFrontmatterOnlyChange(state.update({ changes: { from: state.doc.length, insert: ' text' } }))).toBe(false);
    expect(isFrontmatterOnlyChange(state.update({ changes: { from: 0, insert: 'prefix' } }))).toBe(false);
  });

  it('should map a virtualized Source line through CodeMirror rather than matching its text', () => {
    const line = document.body.createDiv({ cls: 'cm-line', text: 'duplicate: value' });
    const posAtDOM = vi.fn(() => 41);
    const lineAt = vi.fn(() => ({ number: 9 }));

    expect(resolveCodeMirrorDocumentLine(
      castTo<Parameters<typeof resolveCodeMirrorDocumentLine>[0]>({
        posAtDOM,
        state: { doc: { lineAt } }
      }),
      line
    )).toBe(8);
    expect(posAtDOM).toHaveBeenCalledWith(line, 0);
    expect(lineAt).toHaveBeenCalledWith(41);
    posAtDOM.mockImplementation(() => {
      throw new Error('virtualized');
    });
    expect(resolveCodeMirrorDocumentLine(
      castTo<Parameters<typeof resolveCodeMirrorDocumentLine>[0]>({
        posAtDOM,
        state: { doc: { lineAt } }
      }),
      line
    )).toBeNull();
    line.remove();
  });

  it('should resolve a Source property row from pointer coordinates instead of its event target', () => {
    const posAtCoords = vi.fn(() => 27);
    const lineAt = vi.fn(() => ({ number: 4 }));

    expect(resolveCodeMirrorDocumentLineAtPointer(
      castTo<Parameters<typeof resolveCodeMirrorDocumentLineAtPointer>[0]>({
        posAtCoords,
        state: { doc: { lineAt } }
      }),
      1400,
      84
    )).toBe(3);
    expect(posAtCoords).toHaveBeenCalledWith({ x: 1400, y: 84 }, false);
    expect(lineAt).toHaveBeenCalledWith(27);
  });

  it('should disambiguate duplicate Source-mode keys from surrounding visible YAML lines', () => {
    const source = ['---', 'Retail Prices:', '  Worldwide:', '    "1":', '      Date:', '      Price:', 'Other:', '  Price:', '---'].join('\n');
    const content = document.body.createDiv({ cls: 'cm-content' });
    const lines = source.split('\n').slice(1, 8).map((text) => content.createDiv({ cls: 'cm-line', text }));
    const nestedPrice = lines[4];
    if (nestedPrice === undefined) {
      throw new Error('Expected the nested Price line');
    }

    expect(resolveSourceLine(nestedPrice, source, 7)).toBe(5);
    nestedPrice.dataset['line'] = '12';
    expect(resolveSourceLine(nestedPrice, source, 7)).toBe(12);
    content.remove();
  });

  it('should resolve computed Style Settings variables once per tree render', () => {
    const element = document.body.createDiv();
    element.setCssProps({ '--np-first': '12.5px' });
    const computedStyleSpy = vi.spyOn(window, 'getComputedStyle');

    const readNumber = createCssNumberReader(element);

    expect(readNumber('--np-first', 1)).toBe(12.5);
    expect(readNumber('--np-first', 2)).toBe(12.5);
    expect(readNumber('--np-missing', 7)).toBe(7);
    expect(readNumber('--np-missing', 8)).toBe(8);
    expect(computedStyleSpy).toHaveBeenCalledTimes(1);
    computedStyleSpy.mockRestore();
    element.remove();
  });

  it('should prune descendants of collapsed property fields', () => {
    const rootElement = document.body.createDiv({ cls: 'metadata-property is-collapsed' });
    const childElement = document.body.createDiv({ cls: 'metadata-property' });
    const siblingElement = document.body.createDiv({ cls: 'metadata-property' });
    function createNode(element: HTMLElement, key: string): PropertyFieldNode {
      return {
        children: [],
        depth: 0,
        element,
        key,
        keyElement: element,
        parent: null,
        valueElement: null
      };
    }
    const root = createNode(rootElement, 'root');
    const child = createNode(childElement, 'child');
    const sibling = createNode(siblingElement, 'sibling');
    child.depth = 1;
    child.parent = root;
    root.children.push(child);

    expect(flattenVisiblePropertyFieldForest([root, sibling])).toEqual([root, sibling]);
    rootElement.classList.remove('is-collapsed');
    expect(flattenVisiblePropertyFieldForest([root, sibling])).toEqual([root, child, sibling]);
    rootElement.remove();
    childElement.remove();
    siblingElement.remove();
  });

  it('should render only shown metadata containers', () => {
    const shown = document.body.createDiv({ cls: 'metadata-container' });
    const hiddenParent = document.body.createDiv();
    hiddenParent.hide();
    const hidden = hiddenParent.createDiv({ cls: 'metadata-container' });
    vi.spyOn(shown, 'isShown').mockReturnValue(true);
    vi.spyOn(hidden, 'isShown').mockReturnValue(false);

    expect(getShownMetadataContainers(document)).toContain(shown);
    expect(getShownMetadataContainers(document)).not.toContain(hidden);
    shown.remove();
    hiddenParent.remove();
  });

  it('should render only shown full Source-mode editor views', () => {
    const source = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const livePreview = document.body.createDiv({ cls: 'markdown-source-view mod-cm6 is-live-preview' });
    const hidden = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    vi.spyOn(source, 'isShown').mockReturnValue(true);
    vi.spyOn(hidden, 'isShown').mockReturnValue(false);

    expect(getShownSourceViews(document)).toEqual([source]);
    source.remove();
    livePreview.remove();
    hidden.remove();
  });

  it('should reuse a container render until its generation, dimensions, or active field changes', () => {
    const activeElement = document.body.createDiv();
    const snapshot = { activeElement, generation: 4, height: 200, width: 300 };

    expect(isContainerRenderCurrent(snapshot, 4, 300, 200, activeElement)).toBe(true);
    expect(isContainerRenderCurrent(snapshot, 5, 300, 200, activeElement)).toBe(false);
    expect(isContainerRenderCurrent(snapshot, 4, 301, 200, activeElement)).toBe(false);
    expect(isContainerRenderCurrent(snapshot, 4, 300, 201, activeElement)).toBe(false);
    expect(isContainerRenderCurrent(snapshot, 4, 300, 200, null)).toBe(false);
    expect(isContainerRenderCurrent(undefined, 4, 300, 200, null)).toBe(false);
    activeElement.remove();
  });
});

describe('property field visual mutation filters', () => {
  it('should ignore unrelated Live Preview churn and visual-owned mutations', () => {
    const editor = document.body.createDiv();
    editor.className = 'cm-content';
    const line = editor.createDiv();
    line.className = 'cm-line';
    expect(isPropertyFieldMutation(createMutation(editor, [line]))).toBe(false);

    const metadata = document.body.createDiv();
    metadata.className = 'metadata-container';
    const overlay = createSvg('svg');
    overlay.classList.add('np-property-tree-overlay');
    expect(isPropertyFieldMutation(createMutation(metadata, [overlay]))).toBe(false);
    const path = overlay.createSvg('path');
    expect(isPropertyFieldMutation(createMutation(overlay, [path]))).toBe(false);
    const headerActions = metadata.createDiv({ cls: 'nested-properties-header-actions' });
    const headerIcon = headerActions.createSvg('svg');
    expect(isPropertyFieldMutation(createMutation(headerActions, [headerIcon]))).toBe(false);
    editor.remove();
    metadata.remove();
  });

  it('should render for metadata edits, additions, and removals', () => {
    const metadata = document.body.createDiv();
    metadata.className = 'metadata-container';
    const property = metadata.createDiv();
    property.className = 'metadata-property';
    const value = document.createTextNode('changed');
    property.append(value);
    expect(isPropertyFieldMutation(createMutation(property, [value]))).toBe(true);
    expect(isPropertyFieldMutation(createMutation(document.body, [metadata]))).toBe(true);
    expect(isPropertyFieldMutation(createMutation(document.body, [], [metadata]))).toBe(true);
    expect(getPropertyFieldMutationContainers(createMutation(property, [value]))).toEqual([metadata]);
    const leaf = document.body.createDiv();
    leaf.append(metadata);
    expect(getPropertyFieldMutationContainers(createMutation(document.body, [leaf]))).toEqual([]);
    metadata.remove();
    leaf.remove();
  });

  it('should redraw Source overlays for visible CodeMirror line changes but ignore Live Preview churn', () => {
    const sourceView = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const sourceContent = sourceView.createDiv({ cls: 'cm-content' });
    const sourceLine = sourceContent.createDiv({ cls: 'cm-line' });
    const liveView = document.body.createDiv({ cls: 'markdown-source-view mod-cm6 is-live-preview' });
    const liveContent = liveView.createDiv({ cls: 'cm-content' });
    const liveLine = liveContent.createDiv({ cls: 'cm-line' });
    const overlay = sourceView.createSvg('svg');
    overlay.classList.add('np-property-source-overlay');

    expect(isSourceEditorMutation(createMutation(sourceContent, [sourceLine]))).toBe(true);
    expect(isSourceEditorMutation(createMutation(document.body, [liveView]))).toBe(true);
    expect(isSourceEditorMutation(createMutation(liveContent, [liveLine]))).toBe(false);
    expect(isSourceEditorMutation(createMutation(overlay, [overlay.createSvg('path')]))).toBe(false);
    sourceView.remove();
    liveView.remove();
  });

  it('should invalidate only actual Source and Live Preview mode transitions', () => {
    const sourceView = document.body.createDiv({ cls: 'markdown-source-view mod-cm6' });
    const modeChange = createAttributeMutation(sourceView, 'class', 'markdown-source-view mod-cm6 is-live-preview');
    expect(isSourceViewModeMutation(modeChange)).toBe(true);

    const oldValue = sourceView.className;
    sourceView.classList.add('np-property-source-overlay-host');
    expect(isSourceViewModeMutation(createAttributeMutation(sourceView, 'class', oldValue))).toBe(false);
    expect(isSourceViewModeMutation(createAttributeMutation(document.body, 'class', 'theme-dark'))).toBe(false);
    sourceView.remove();
  });

  it('should redraw only for plugin-owned body classes and style variables', () => {
    const target = document.body.createDiv();
    target.className = 'theme-dark workspace-tab-header-container';
    expect(isPropertyVisualStyleMutation(createAttributeMutation(target, 'class', 'theme-dark'))).toBe(false);
    target.classList.add('np-guide-line-dashed');
    expect(isPropertyVisualStyleMutation(createAttributeMutation(target, 'class', 'theme-dark workspace-tab-header-container'))).toBe(true);

    target.setCssProps({ color: 'red' });
    expect(isPropertyVisualStyleMutation(createAttributeMutation(target, 'style', ''))).toBe(false);
    const oldStyle = target.getAttribute('style') ?? '';
    target.setCssProps({ '--np-guide-connector-length': '22px' });
    expect(isPropertyVisualStyleMutation(createAttributeMutation(target, 'style', oldStyle))).toBe(true);
    target.remove();
  });
});
