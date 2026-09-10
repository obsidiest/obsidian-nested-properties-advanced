import type {
  MarkdownView,
  Plugin
} from 'obsidian';

import {
  ContextId,
  evalInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { writeDesktopFixtures } from '../scripts/desktop-fixtures.ts';

const TEST_NOTE_PATH = 'property-field-visuals.md';
const ROOT_KEY_BEFORE = 'historyRoot';
const vault = getTemporaryVault();

interface Context {
  markdownView: MarkdownView;
}

interface HistoryCase {
  after: string;
  before: string;
  key: string;
  kind: string;
  text: string;
}

const HISTORY_CASES: HistoryCase[] = [
  { after: 'historyRootRenamed: original', before: 'historyRoot: original', key: 'historyRoot', kind: 'key', text: 'historyRootRenamed' },
  { after: 'historyRoot: changed', before: 'historyRoot: original', key: 'historyRoot', kind: 'value', text: 'changed' },
  { after: 'leafRenamed: value', before: 'leaf: value', key: 'leaf', kind: 'key', text: 'leafRenamed' },
  { after: 'leaf: changed', before: 'leaf: value', key: 'leaf', kind: 'value', text: 'changed' }
];

interface PropertyVisualSettings {
  isActiveCursorPropertyFieldThreadingEnabled: boolean;
  isActivePropertyFieldThreadingEnabled: boolean;
  isActivePropertyFieldThreadingInMainUiEnabled: boolean;
  isFullWidthPropertyFieldHoverActivationEnabled: boolean;
  isFullWidthPropertyKeyHoverActivationEnabled: boolean;
  isPropertyFieldHoverBreadcrumbEnabled: boolean;
  isPropertyFieldHoverBreadcrumbInLivePreviewEnabled: boolean;
  isPropertyFieldHoverBreadcrumbInSourceModeEnabled: boolean;
  isPropertyFieldThreadingEnabled: boolean;
  isPropertyFieldThreadingInLivePreviewEnabled: boolean;
  isPropertyFieldThreadingInMainUiEnabled: boolean;
  isPropertyFieldThreadingInSourceModeEnabled: boolean;
}

interface TestPlugin extends Plugin {
  pluginSettingsComponent: TestPluginSettingsComponent;
}

interface TestPluginSettingsComponent {
  editAndSave(editor: (settings: PropertyVisualSettings) => void): Promise<void>;
}

const contextId = new ContextId<Context>();

function createLongFrontmatter(): string {
  const filler = Array.from({ length: 70 }, (_value, index) => `filler${String(index).padStart(2, '0')}: value`).join('\n');
  return `---
${ROOT_KEY_BEFORE}: original
flat.object: flattened
nested:
  child:
    leaf: value
${filler}
---

Body
`;
}

beforeAll(async () => {
  await writeDesktopFixtures(vault.path, {
    [TEST_NOTE_PATH]: createLongFrontmatter()
  });
});

beforeEach(async () => {
  await evalInObsidian({
    callback: async ({ app, context, fixture, lib: { hoverElement, waitUntil } }) => {
      const file = app.vault.getFileByPath('property-field-visuals.md');
      if (file === null) {
        throw new Error('Property visuals fixture was not found');
      }
      await app.vault.modify(file, fixture);
      const leaf = app.workspace.getLeaf(true);
      await leaf.setViewState({
        state: {
          file: file.path,
          mode: 'source',
          source: false
        },
        type: 'markdown'
      });
      const markdownView = app.workspace.getActiveFileView();
      if (markdownView?.getViewType() !== 'markdown') {
        throw new Error('Markdown view did not open');
      }
      context.markdownView = markdownView as MarkdownView;
      await waitUntil({
        message: 'Live Preview Properties editor did not render',
        predicate: () => markdownView.containerEl.querySelector(':scope .metadata-container .metadata-property-key-input') !== null,
        timeoutInMilliseconds: 15_000
      });
      await hoverElement({ element: leaf.tabHeaderEl });
      await waitUntil({ predicate: () => leaf.view.containerEl.ownerDocument.querySelector('.np-property-breadcrumb-popover') === null });
    },
    contextId,
    input: { fixture: createLongFrontmatter() },
    vaultPath: vault.path
  });
});

afterEach(async () => {
  await evalInObsidian({
    callback: ({ context }) => {
      (context as Partial<Context>).markdownView?.leaf.detach();
    },
    contextId,
    vaultPath: vault.path
  });
});

afterAll(async () => {
  await contextId.dispose();
});

describe('property-field visuals in real Obsidian', () => {
  it.each(HISTORY_CASES.flatMap((historyCase) => ['blur', 'Escape'].map((exit) => ({ ...historyCase, exit }))))('routes native $key $kind history after $exit without changing scroll', async (historyCase) => {
    const result = await evalInObsidian({
      callback: async ({ context: { markdownView }, historyCase: testCase, lib: { clickElement, clickMouse, pressKey, waitUntil } }) => {
        const ownerDocument = markdownView.containerEl.ownerDocument;
        const sourceView = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view.is-live-preview');
        const focusExitTarget = markdownView.leaf.containerEl.querySelector<HTMLElement>('.view-header');
        const inputs = [...markdownView.containerEl.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')];
        const keyInput = inputs.find((candidate) => candidate.value === testCase.key);
        const input = testCase.kind === 'key' ? keyInput : keyInput?.closest('.metadata-property')?.querySelector<HTMLElement>(':scope > .metadata-property-value input, :scope > .metadata-property-value textarea, :scope > .metadata-property-value [contenteditable="true"]');
        if (sourceView === null || focusExitTarget === null || input === undefined || input === null) {
          throw new Error('Live Preview history fixture did not render');
        }
        const scroller = sourceView.querySelector<HTMLElement>('.cm-scroller');
        if (scroller === null) {
          throw new Error('Live Preview scroller was not found');
        }
        const activeScroller = scroller;
        const editedInput = input;
        const activeSource = sourceView;
        function recordFocusTrace(): object[] {
          const events: object[] = [];
          for (const eventName of ['focusin', 'focusout', 'keydown']) {
            activeSource.addEventListener(eventName, (event) => {
              if (!(events.length < 80)) {
                return;
              }

              const target = event.target as Element;
              events.push({
                field: target.closest('.metadata-property')?.querySelector<HTMLInputElement>('.metadata-property-key-input')?.value,
                key: (event as KeyboardEvent).key,
                target: target.className,
                time: performance.now(),
                type: event.type
              });
            }, { capture: true });
          }
          return events;
        }
        const focusTrace = recordFocusTrace();
        async function waitForFocus(message: string, isReady: () => boolean): Promise<void> {
          try {
            await waitUntil({ message, predicate: isReady });
          } catch (error) {
            const rect = editedInput.getBoundingClientRect();
            throw new Error(
              `${message}: ${
                JSON.stringify({
                  active: activeSource.ownerDocument.activeElement?.outerHTML.slice(0, 500),
                  focusTrace,
                  inputConnected: editedInput.isConnected,
                  pointerTarget: activeSource.ownerDocument.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)?.outerHTML.slice(0, 500)
                })
              }`,
              { cause: error }
            );
          }
        }

        activeScroller.scrollTop = 0;
        clickElement({ element: input });
        await waitForFocus('The property input did not receive the click', () => ownerDocument.activeElement === input);
        pressKey({ key: 'a', modifiers: ['Ctrl'] });
        for (const character of testCase.text) {
          pressKey({ key: character });
        }
        await waitUntil({
          message: 'Trusted input did not finish editing the property',
          predicate: () => (input.instanceOf(HTMLInputElement) || input.instanceOf(HTMLTextAreaElement) ? input.value : input.textContent) === testCase.text
        });
        if (testCase.exit === 'Escape') {
          // Native key and text-value Escape cancel uncommitted text. Enter commits first;
          // Escape then leaves the control reached during the metadata focus handoff.
          pressKey({ key: 'Enter' });
          await waitUntil({ message: 'Enter did not commit the property edit', predicate: () => markdownView.editor.getValue().includes(testCase.after) });
          await waitUntil({
            message: 'Enter did not hand focus to the property value or row',
            predicate: () =>
              testCase.kind === 'key' && input.closest('.nested-properties-container') === null
                ? ownerDocument.activeElement?.closest('.metadata-property-value') !== null && ownerDocument.activeElement !== input
                : !ownerDocument.activeElement?.matches('input, textarea, [contenteditable="true"]')
          });
          pressKey({ key: 'Escape' });
        } else {
          // The title itself is contenteditable. Use the header's outer padding so focus
          // Leaves the property without starting a file rename or collapsing Properties.
          const exitRect = focusExitTarget.getBoundingClientRect();
          clickMouse({ x: exitRect.left + 2, y: exitRect.top + 2 });
        }
        await waitForFocus('Focus did not leave the property input', () => !ownerDocument.activeElement?.matches('input, textarea, [contenteditable="true"]'));
        await waitUntil({
          message: 'Property edit did not commit after leaving the field',
          predicate: () => markdownView.editor.getValue().includes(testCase.after)
        });
        const scrollTopBeforeHistory = activeScroller.scrollTop;
        async function measureMaximumScrollDelta(): Promise<number> {
          let maximumDelta = 0;
          for (let index = 0; index < 20; index += 1) {
            await new Promise<void>((resolve) => {
              ownerDocument.defaultView?.setTimeout(resolve, 50);
            });
            maximumDelta = Math.max(maximumDelta, Math.abs(activeScroller.scrollTop - scrollTopBeforeHistory));
          }
          return maximumDelta;
        }

        pressKey({ key: 'z', modifiers: ['Ctrl'] });
        await waitUntil({
          message: 'Ctrl+Z did not undo the committed property edit',
          predicate: () => markdownView.editor.getValue().includes(testCase.before)
        });
        const maximumUndoScrollDelta = await measureMaximumScrollDelta();
        const scrollTopAfterUndo = activeScroller.scrollTop;

        pressKey({ key: 'y', modifiers: ['Ctrl'] });
        await waitUntil({
          message: 'Ctrl+Y did not redo the committed property edit',
          predicate: () => markdownView.editor.getValue().includes(testCase.after)
        });
        const maximumRedoScrollDelta = await measureMaximumScrollDelta();
        const scrollTopAfterRedo = activeScroller.scrollTop;

        return {
          activeElementClass: ownerDocument.activeElement?.className ?? '',
          maximumRedoScrollDelta,
          maximumUndoScrollDelta,
          scrollTopAfterRedo,
          scrollTopAfterUndo,
          scrollTopBeforeHistory
        };
      },
      contextId,
      input: { historyCase },
      vaultPath: vault.path
    });

    expect(Math.abs(result.scrollTopAfterUndo - result.scrollTopBeforeHistory)).toBeLessThanOrEqual(2);
    expect(Math.abs(result.scrollTopAfterRedo - result.scrollTopBeforeHistory)).toBeLessThanOrEqual(2);
    expect(result.maximumUndoScrollDelta).toBeLessThanOrEqual(2);
    expect(result.maximumRedoScrollDelta).toBeLessThanOrEqual(2);
  });

  it('activates threading and each breadcrumb scope on its exact Live Preview surface', async () => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { markdownView }, lib: { moveMouse, waitUntil } }) => {
        const plugin = app.plugins.getPlugin('nested-properties-advanced');
        if (plugin === null) {
          throw new Error('Nested Properties Advanced is not enabled');
        }
        const testPlugin = plugin as TestPlugin;
        async function setScope(isFieldScopeEnabled: boolean, isKeyScopeEnabled: boolean): Promise<void> {
          await testPlugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.isActiveCursorPropertyFieldThreadingEnabled = false;
            settings.isActivePropertyFieldThreadingEnabled = true;
            settings.isActivePropertyFieldThreadingInMainUiEnabled = true;
            settings.isFullWidthPropertyFieldHoverActivationEnabled = isFieldScopeEnabled;
            settings.isFullWidthPropertyKeyHoverActivationEnabled = isKeyScopeEnabled;
            settings.isPropertyFieldHoverBreadcrumbEnabled = true;
            settings.isPropertyFieldHoverBreadcrumbInLivePreviewEnabled = true;
            settings.isPropertyFieldThreadingEnabled = true;
            settings.isPropertyFieldThreadingInLivePreviewEnabled = true;
            settings.isPropertyFieldThreadingInMainUiEnabled = true;
          });
        }
        const ownerDocument = markdownView.containerEl.ownerDocument;
        const sourceView = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view.is-live-preview');
        const metadataHeading = markdownView.containerEl.querySelector<HTMLElement>('.metadata-properties-heading');
        const propertyRows = [...markdownView.containerEl.querySelectorAll<HTMLElement>('.metadata-property')];
        const property = propertyRows.find((row) => row.querySelector<HTMLInputElement>(':scope > .metadata-property-key .metadata-property-key-input')?.value === 'flat.object');
        const keyElement = property?.querySelector<HTMLElement>(':scope > .metadata-property-key');
        const icon = keyElement?.querySelector<HTMLElement>('.metadata-property-icon');
        if (sourceView === null || metadataHeading === null || property === undefined || keyElement === null || keyElement === undefined || icon === null || icon === undefined) {
          throw new Error('Live Preview pointer fixture did not render');
        }
        const rowRect = keyElement.getBoundingClientRect();
        const sourceRect = sourceView.getBoundingClientRect();
        const farRightX = sourceRect.right - 24;
        const rowY = (rowRect.top + rowRect.bottom) / 2;
        function isPopoverVisible(): boolean {
          return ownerDocument.querySelector('.np-property-breadcrumb-popover') !== null;
        }
        function isThreadActive(): boolean {
          return ownerDocument.querySelector('.np-property-thread-active, .np-property-thread-all, .np-property-thread-root-active, .np-property-thread-root-all') !== null;
        }
        async function nextAnimationFrame(): Promise<void> {
          await new Promise<void>((resolve) => {
            ownerDocument.defaultView?.requestAnimationFrame(() => {
              resolve();
            });
          });
        }
        async function waitForPopover(message: string): Promise<void> {
          await waitUntil({ message, predicate: isPopoverVisible });
        }
        async function waitForPopoverToHide(message: string): Promise<void> {
          await waitUntil({ message, predicate: () => !isPopoverVisible() });
        }

        await setScope(true, false);
        moveMouse({ x: farRightX, y: rowY });
        await waitForPopover('Full-field hover did not show its breadcrumb');
        await waitUntil({ message: 'Full-row hover did not activate property threading', predicate: isThreadActive });
        const isFullFieldActivated = isPopoverVisible() && isThreadActive();

        const metadataHeadingRect = metadataHeading.getBoundingClientRect();
        moveMouse({ x: (metadataHeadingRect.left + metadataHeadingRect.right) / 2, y: (metadataHeadingRect.top + metadataHeadingRect.bottom) / 2 });
        await waitForPopoverToHide('Full-field breadcrumb did not deactivate after leaving its row');

        await setScope(false, true);
        const keyInput = keyElement.querySelector<HTMLElement>('.metadata-property-key-input');
        if (keyInput === null) {
          throw new Error('Live Preview property key input was not found');
        }
        const keyInputRect = keyInput.getBoundingClientRect();
        const keyIconRect = icon.getBoundingClientRect();
        const keyContentLeft = Math.min(keyIconRect.left, keyInputRect.left);
        const keyContentRight = Math.max(keyIconRect.right, keyInputRect.right);
        moveMouse({ x: (keyContentLeft + keyContentRight) / 2, y: rowY });
        await waitForPopover('Full-key hover did not show its breadcrumb');
        const isFullKeyActivated = isPopoverVisible();
        moveMouse({ x: Math.min(sourceRect.right - 24, keyContentRight + 80), y: rowY });
        await nextAnimationFrame();
        const isFullKeyRetainedDuringTimeout = isPopoverVisible();
        const isThreadActiveOutsideKey = isThreadActive();
        await waitForPopoverToHide('Full-key breadcrumb remained active outside the property key');
        const isFullKeyDeactivated = !isPopoverVisible();

        await setScope(false, false);
        const iconRect = (icon.querySelector('svg') ?? icon).getBoundingClientRect();
        moveMouse({ x: (iconRect.left + iconRect.right) / 2, y: (iconRect.top + iconRect.bottom) / 2 });
        await waitForPopover('Icon-only hover did not show its breadcrumb');
        const isIconActivated = isPopoverVisible();
        moveMouse({ x: Math.min(sourceRect.right - 24, iconRect.right + 60), y: rowY });
        await nextAnimationFrame();
        const isIconRetainedDuringTimeout = isPopoverVisible();
        await waitForPopoverToHide('Icon-only breadcrumb remained active outside the property icon');
        const isIconDeactivated = !isPopoverVisible();

        return {
          fullFieldActivated: isFullFieldActivated,
          fullKeyActivated: isFullKeyActivated,
          fullKeyDeactivated: isFullKeyDeactivated,
          fullKeyRetainedDuringTimeout: isFullKeyRetainedDuringTimeout,
          iconActivated: isIconActivated,
          iconDeactivated: isIconDeactivated,
          iconRetainedDuringTimeout: isIconRetainedDuringTimeout,
          threadActiveOutsideKey: isThreadActiveOutsideKey
        };
      },
      contextId,
      vaultPath: vault.path
    });

    expect(result).toEqual({
      fullFieldActivated: true,
      fullKeyActivated: true,
      fullKeyDeactivated: true,
      fullKeyRetainedDuringTimeout: true,
      iconActivated: true,
      iconDeactivated: true,
      iconRetainedDuringTimeout: true,
      threadActiveOutsideKey: true
    });
  });

  it('activates root and flattened Source fields across the editor width', async () => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { markdownView }, lib: { moveMouse, waitUntil } }) => {
        const plugin = app.plugins.getPlugin('nested-properties-advanced');
        if (plugin === null) {
          throw new Error('Nested Properties Advanced is not enabled');
        }
        const testPlugin = plugin as TestPlugin;
        await testPlugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.isActiveCursorPropertyFieldThreadingEnabled = false;
          settings.isFullWidthPropertyFieldHoverActivationEnabled = true;
          settings.isFullWidthPropertyKeyHoverActivationEnabled = false;
          settings.isPropertyFieldHoverBreadcrumbEnabled = true;
          settings.isPropertyFieldHoverBreadcrumbInSourceModeEnabled = true;
          settings.isPropertyFieldThreadingEnabled = true;
          settings.isPropertyFieldThreadingInMainUiEnabled = true;
          settings.isPropertyFieldThreadingInSourceModeEnabled = true;
        });
        const leaf = markdownView.leaf;
        await leaf.setViewState({
          state: {
            file: markdownView.file?.path,
            mode: 'source',
            source: true
          },
          type: 'markdown'
        });
        await waitUntil({
          message: 'Source mode did not render',
          predicate: () => markdownView.containerEl.querySelector(':scope .markdown-source-view:not(.is-live-preview) .cm-line') !== null
        });
        const ownerDocument = markdownView.containerEl.ownerDocument;
        const sourceView = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view:not(.is-live-preview)');
        if (sourceView === null) {
          throw new Error('Source view was not found');
        }
        const activeSourceView = sourceView;
        const sourceRect = sourceView.getBoundingClientRect();
        function getKeyRect(line: HTMLElement, keyLength: number): DOMRect {
          const walker = ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          let remaining = keyLength;
          while (node !== null && remaining > (node.textContent?.length ?? 0)) {
            remaining -= node.textContent?.length ?? 0;
            node = walker.nextNode();
          }
          if (node === null) {
            throw new Error('Rendered Source key text was not found');
          }
          const range = ownerDocument.createRange();
          range.selectNodeContents(line);
          range.setEnd(node, remaining);
          return range.getBoundingClientRect();
        }
        async function isLineActivated(text: string, expectedBreadcrumbText: string, isKeyScope = false): Promise<boolean> {
          const line = [...activeSourceView.querySelectorAll<HTMLElement>('.cm-line')].find((candidate) => candidate.textContent.includes(text));
          if (line === undefined) {
            throw new Error(`Source line was not found: ${text}`);
          }
          const rect = line.getBoundingClientRect();
          const keyRect = isKeyScope ? getKeyRect(line, text.length) : null;
          moveMouse({ x: keyRect === null ? sourceRect.right - 24 : (keyRect.left + keyRect.right) / 2, y: (rect.top + rect.bottom) / 2 });
          await waitUntil({
            message: `Source breadcrumb did not activate for ${text}`,
            predicate: () => ownerDocument.querySelector<HTMLElement>('.np-property-breadcrumb-popover')?.textContent.includes(expectedBreadcrumbText) === true
          });
          if (isKeyScope) {
            moveMouse({ x: sourceRect.right - 24, y: (rect.top + rect.bottom) / 2 });
            await waitUntil({
              message: `Source key breadcrumb stayed active beyond ${text}`,
              predicate: () => ownerDocument.querySelector('.np-property-breadcrumb-popover') === null
            });
          }
          return ownerDocument.querySelector('.np-property-field-source-highlight') === line;
        }

        const isFlattenedFieldActive = await isLineActivated('flat.object:', 'flat.object');
        const isRootFieldActive = await isLineActivated('historyRoot:', 'historyRoot');
        moveMouse({ x: sourceRect.right - 24, y: sourceRect.top + 1 });
        await waitUntil({ message: 'Source field breadcrumb did not deactivate outside its row', predicate: () => ownerDocument.querySelector('.np-property-breadcrumb-popover') === null });
        await testPlugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.isFullWidthPropertyFieldHoverActivationEnabled = false;
          settings.isFullWidthPropertyKeyHoverActivationEnabled = true;
        });

        return {
          flattened: isFlattenedFieldActive,
          flattenedKey: await isLineActivated('flat.object:', 'flat.object', true),
          root: isRootFieldActive,
          rootKey: await isLineActivated('historyRoot:', 'historyRoot', true)
        };
      },
      contextId,
      vaultPath: vault.path
    });

    expect(result).toEqual({ flattened: true, flattenedKey: true, root: true, rootKey: true });
  });
});
