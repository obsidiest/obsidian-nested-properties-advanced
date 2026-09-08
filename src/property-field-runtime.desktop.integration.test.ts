import type {
  MarkdownView,
  PluginSettingTab
} from 'obsidian';

import {
  ContextId,
  evalInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

const vault = getTemporaryVault();
interface RuntimeContext {
  markdownView: MarkdownView;
  settingsTab: PluginSettingTab;
  showInlineTitle: unknown;
  showViewHeader: unknown;
  theme: string;
}
const contextId = new ContextId<RuntimeContext>();
const FIXTURE = `---
root: original
flat.object: flattened
Long property key that wraps onto another visual line when the editor is narrow: original
nested:
  child:
    leaf: value
${Array.from({ length: 100 }, (_value, index) => `filler${String(index)}: value`).join('\n')}
---

Body
`;
let minimalCss = '';

beforeAll(async () => {
  // Pin the real stylesheet; do not silently test whatever the theme's next release changes.
  const response = await fetch('https://raw.githubusercontent.com/kepano/obsidian-minimal/504c2e9c27012f4ea7cc898d242722ee8b795dbc/theme.css');
  if (!response.ok) {
    throw new Error(`Could not load pinned Minimal stylesheet: ${String(response.status)}`);
  }
  minimalCss = await response.text();
  vault.populate({
    '.obsidian/themes/Minimal-runtime/manifest.json': JSON.stringify({ author: '@kepano', minAppVersion: '1.9.0', name: 'Minimal-runtime', version: '8.2.2' }),
    '.obsidian/themes/Minimal-runtime/theme.css': minimalCss,
    'property-runtime.md': FIXTURE
  });
});

beforeEach(async () => {
  await evalInObsidian({
    callback: async ({ app, context, css, fixture, lib: { waitUntil } }) => {
      context.showInlineTitle = app.vault.getConfig('showInlineTitle');
      context.showViewHeader = app.vault.getConfig('showViewHeader');
      app.vault.setConfig('showInlineTitle', false);
      app.vault.setConfig('showViewHeader', false);
      context.theme = app.customCss.theme;
      app.customCss.setTheme('Minimal-runtime');
      await waitUntil({ message: 'Minimal stylesheet did not load', predicate: () => app.customCss.styleEl.textContent.includes(css.slice(0, 100)) });
      const file = app.vault.getFileByPath('property-runtime.md');
      if (file === null) {
        throw new Error('Runtime fixture missing');
      }
      await app.vault.modify(file, fixture);
      const leaf = app.workspace.getLeaf(true);
      await leaf.setViewState({ state: { file: file.path, mode: 'source', source: false }, type: 'markdown' });
      context.markdownView = leaf.view as MarkdownView;
      const tab = app.setting.pluginTabs.find((candidate) => candidate.id === 'nested-properties-advanced');
      if (tab === undefined) {
        throw new Error('Property settings tab missing');
      }
      context.settingsTab = tab;
      await waitUntil({ predicate: () => leaf.view.containerEl.querySelector('.metadata-property-key-input') !== null });
      await tab.setControlValue('isActiveCursorPropertyFieldThreadingEnabled', false);
      await tab.setControlValue('isPropertyFieldThreadingEnabled', true);
      await tab.setControlValue('isPropertyFieldThreadingInMainUiEnabled', true);
      await tab.setControlValue('isPropertyFieldHoverBreadcrumbEnabled', true);
      await tab.setControlValue('isFullWidthPropertyFieldHoverActivationEnabled', true);
    },
    contextId,
    input: { css: minimalCss, fixture: FIXTURE },
    vaultPath: vault.path
  });
});

afterEach(async () => {
  await evalInObsidian({
    callback: ({ app, context }) => {
      app.customCss.setTheme(context.theme);
      context.markdownView.leaf.detach();
      app.vault.setConfig('showInlineTitle', context.showInlineTitle);
      app.vault.setConfig('showViewHeader', context.showViewHeader);
    },
    contextId,
    vaultPath: vault.path
  });
});

describe('Property interaction surfaces with Minimal and hidden titles', () => {
  it.each([false, true])('sweeps root, flattened and nested rows with Source=%s', async (isSource) => {
    const result = await evalInObsidian({
      // eslint-disable-next-line complexity -- The serialized desktop callback compares all regions in one pointer traversal.
      callback: async ({ context: { markdownView, settingsTab }, isSourceMode, lib: { moveMouse, waitUntil } }) => {
        await markdownView.leaf.setViewState({ state: { file: 'property-runtime.md', mode: 'source', source: isSourceMode }, type: 'markdown' });
        const doc = markdownView.containerEl.ownerDocument;
        const win = doc.defaultView;
        const source = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view');
        if (source === null || win === null) {
          throw new Error('Editor surface missing');
        }
        await waitUntil({ predicate: () => source.classList.contains('is-live-preview') !== isSourceMode });
        const failures: object[] = [];
        for (const scope of ['field', 'key', 'icon']) {
          if (isSourceMode && scope === 'icon') {
            continue;
          }
          await settingsTab.setControlValue('isFullWidthPropertyFieldHoverActivationEnabled', scope === 'field');
          await settingsTab.setControlValue('isFullWidthPropertyKeyHoverActivationEnabled', scope === 'key');
          for (const key of ['root', 'flat.object', 'nested', 'child', 'leaf']) {
            const keyInput = [...source.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((input) => input.value === key);
            const row = isSourceMode
              ? [...source.querySelectorAll<HTMLElement>('.cm-line')].find((line) => line.textContent.trimStart().startsWith(`${key}:`))
              : keyInput?.closest<HTMLElement>('.metadata-property');
            if (row === undefined || row === null) {
              failures.push({ key, reason: 'row missing', scope });
              continue;
            }
            const keyElement = isSourceMode ? row : row.querySelector<HTMLElement>(':scope > .metadata-property-key');
            const icon = row.querySelector<HTMLElement>(':scope > .metadata-property-key .metadata-property-icon, :scope > .metadata-property-key .nested-properties-collapse-btn');
            if (keyElement === null) {
              throw new Error('Key missing');
            }
            const rect = keyElement.getBoundingClientRect();
            const surface = source.getBoundingClientRect();
            const y = (rect.top + rect.bottom) / 2;
            const iconRect = (icon?.querySelector('svg') ?? icon)?.getBoundingClientRect();
            function getPositions(): number[] {
              if (scope === 'field') {
                return [surface.left + 4, rect.left + 8, (rect.left + rect.right) / 2, surface.right - 24];
              }
              if (scope === 'key') {
                return [rect.left + 8, rect.left + 24];
              }
              return iconRect === undefined ? [] : [(iconRect.left + iconRect.right) / 2, iconRect.left + 2, iconRect.right - 2];
            }
            const positions = getPositions();
            for (const x of positions) {
              moveMouse({ x, y: scope === 'icon' && iconRect !== undefined ? (iconRect.top + iconRect.bottom) / 2 : y });
              await new Promise<void>((resolve) => {
                win.setTimeout(resolve, 180);
              });
              const current = doc.querySelector(':scope .np-property-breadcrumb-popover .is-current button')?.textContent;
              if (current !== key) {
                failures.push({ current: current ?? null, key, scope, target: doc.elementFromPoint(x, y)?.className, x, y });
              }
            }
            moveMouse({ x: surface.right - 8, y: surface.top + 2 });
            // Electron can coalesce back-to-back mouse moves. Confirm that the exit is
            // Delivered before moving toward a row previously covered by the popover.
            await waitUntil({ predicate: () => doc.querySelector('.np-property-breadcrumb-popover') === null });
          }
        }
        return failures;
      },
      contextId,
      input: { isSourceMode: isSource },
      vaultPath: vault.path
    });
    expect(result).toEqual([]);
  });

  it.each(['root', 'leaf'].flatMap((key) => ['padding', 'breadcrumb'].map((focus) => ({ focus, key }))))('keeps native redo after $key edit, Escape and $focus interaction', async ({ focus, key }) => {
    const result = await evalInObsidian({
      callback: async ({ context: { markdownView }, focusTarget, keyName, lib: { clickElement, clickMouse, moveMouse, pressKey, waitUntil } }) => {
        const source = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view');
        const input = [...markdownView.containerEl.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((candidate) => candidate.value === keyName);
        if (source === null || input === undefined) {
          throw new Error('History surface missing');
        }
        clickElement({ element: input });
        pressKey({ key: 'a', modifiers: ['Ctrl'] });
        for (const character of `${keyName}Changed`) {
          pressKey({ key: character });
        }
        pressKey({ key: 'Enter' });
        await waitUntil({ predicate: () => markdownView.editor.getValue().includes(`${keyName}Changed:`) });
        pressKey({ key: 'Escape' });
        const sourceRect = source.getBoundingClientRect();
        clickMouse({ x: sourceRect.right - 30, y: sourceRect.top + 80 });
        const doc = source.ownerDocument;
        const focusBeforeUndo = doc.activeElement?.className;
        pressKey({ key: 'z', modifiers: ['Ctrl'] });
        await waitUntil({ message: 'Undo from editor padding failed', predicate: () => markdownView.editor.getValue().includes(`${keyName}:`) });
        await new Promise<void>((resolve) => {
          doc.defaultView?.setTimeout(resolve, 2500);
        });
        if (focusTarget === 'breadcrumb') {
          const restored = [...source.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((candidate) => candidate.value === keyName);
          if (restored === undefined) {
            throw new Error('Undone property did not render');
          }
          restored.scrollIntoView({ block: 'nearest' });
          const rect = restored.getBoundingClientRect();
          moveMouse({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
          await waitUntil({ predicate: () => doc.querySelector('.np-property-breadcrumb-popover') !== null });
          const button = doc.querySelector<HTMLElement>(':scope .np-property-breadcrumb-popover .is-current button');
          if (button === null) {
            throw new Error('Breadcrumb button missing');
          }
          const buttonRect = button.getBoundingClientRect();
          moveMouse({ x: (buttonRect.left + buttonRect.right) / 2, y: (buttonRect.top + buttonRect.bottom) / 2 });
          await new Promise<void>((resolve) => {
            doc.defaultView?.setTimeout(resolve, 180);
          });
        }
        const focusBeforeRedo = doc.activeElement?.className;
        pressKey({ key: 'y', modifiers: ['Ctrl'] });
        await new Promise<void>((resolve) => {
          doc.defaultView?.setTimeout(resolve, 500);
        });
        return { focusBeforeRedo, focusBeforeUndo, isRedone: markdownView.editor.getValue().includes(`${keyName}Changed:`) };
      },
      contextId,
      input: { focusTarget: focus, keyName: key },
      vaultPath: vault.path
    });
    expect(result.isRedone, JSON.stringify(result)).toBe(true);
  });

  it('activates the clicked full-width row in Active Cursor mode', async () => {
    const result = await evalInObsidian({
      callback: async ({ context: { markdownView, settingsTab }, lib: { clickMouse, waitUntil } }) => {
        await settingsTab.setControlValue('isPropertyFieldHoverBreadcrumbEnabled', false);
        await settingsTab.setControlValue('isActiveCursorPropertyFieldThreadingEnabled', true);
        const source = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view');
        const input = [...markdownView.containerEl.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((candidate) => candidate.value === 'leaf');
        if (source === null || input === undefined) {
          throw new Error('Cursor fixture missing');
        }
        const surface = source.getBoundingClientRect();
        const keyRect = input.getBoundingClientRect();
        clickMouse({ x: surface.right - 24, y: (keyRect.top + keyRect.bottom) / 2 });
        await waitUntil({ predicate: () => source.ownerDocument.activeElement !== source.ownerDocument.body });
        await new Promise<void>((resolve) => {
          source.ownerDocument.defaultView?.setTimeout(resolve, 180);
        });
        return {
          activeKey: source.querySelector<HTMLInputElement>(':scope .np-property-field-active .metadata-property-key-input')?.value ?? null,
          focus: source.ownerDocument.activeElement?.className
        };
      },
      contextId,
      vaultPath: vault.path
    });
    expect(result.activeKey, JSON.stringify(result)).toBe('leaf');
  });
});
