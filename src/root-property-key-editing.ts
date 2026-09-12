import type { MetadataEditorProperty } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import {
  Component,
  MarkdownView
} from 'obsidian';
import { getAllDomWindows } from 'obsidian-dev-utils/obsidian/workspace';

import { getHtmlElement } from './dom-target.ts';

interface RootPropertyKeyEditingComponentConstructorParams {
  readonly app: App;
}

/**
 * Keep root-key cancellation tied to the native row's current metadata entry.
 */
export class RootPropertyKeyEditingComponent extends Component {
  private readonly app: App;
  private readonly observedDocuments = new Set<Document>();

  public constructor(params: RootPropertyKeyEditingComponentConstructorParams) {
    super();
    this.app = params.app;
  }

  public override onload(): void {
    super.onload();
    let isActive = true;
    this.app.workspace.onLayoutReady(() => {
      if (isActive) {
        for (const win of getAllDomWindows(this.app)) {
          this.observeDocument(win.document);
        }
      }
    });
    this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, openedWindow) => {
      this.observeDocument(openedWindow.document);
    }));
    this.register(() => {
      isActive = false;
      this.observedDocuments.clear();
    });
  }

  private observeDocument(doc: Document): void {
    if (this.observedDocuments.has(doc)) {
      return;
    }
    this.observedDocuments.add(doc);
    this.registerDomEvent(doc, 'keydown', (event) => {
      this.onKeyDown(event);
    }, { capture: true });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) {
      return;
    }
    const target = getHtmlElement(event.target);
    if (!target?.matches('.metadata-property-key-input') || !target.closest('.markdown-source-view.is-live-preview')) {
      return;
    }
    for (const { view } of this.app.workspace.getLeavesOfType('markdown')) {
      if (!(view instanceof MarkdownView) || !view.containerEl.contains(target)) {
        continue;
      }
      // Nested keys share the CSS class but belong to the plugin's own editor.
      // Identity also handles controls adopted into a popout's document.
      const property = view.metadataEditor.rendered.find((row) => row.keyInputEl === target);
      if (property !== undefined) {
        didHandleRootPropertyKeyEscape(event, property);
      }
      return;
    }
  }
}

export function didHandleRootPropertyKeyEscape(event: KeyboardEvent, property: MetadataEditorProperty): boolean {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || event.target !== property.keyInputEl) {
    return false;
  }
  // Native synchronization reuses this input with a new entry. Its Escape
  // Listener still closes over the constructor's entry; restoring that stale
  // Key makes native blur save a rollback of an already committed rename.
  // It respects defaultPrevented; keep propagation for other key observers.
  event.preventDefault();
  const key = property.entry.key;
  property.keyInputEl.value = key;
  if (key) {
    property.focusProperty();
  } else {
    property.metadataEditor.removeProperties([property]);
  }
  return true;
}
