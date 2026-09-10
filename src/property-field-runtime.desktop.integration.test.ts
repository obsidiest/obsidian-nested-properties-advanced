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

import { writeDesktopFixtures } from '../scripts/desktop-fixtures.ts';

const vault = getTemporaryVault();
interface NativeElement {
  element: Element;
}
interface NativeInput {
  clickElement(params: NativeElement): void;
  clickMouse(params: NativePoint): void;
  moveMouse(params: NativePoint): void;
  pressKey(params: NativeKey): void;
}
interface NativeKey {
  key: string;
  modifiers?: 'Ctrl'[];
}
interface NativePoint {
  x: number;
  y: number;
}
interface RuntimeContext {
  markdownView: MarkdownView;
  nativeInput: NativeInput;
  settingsTab: PluginSettingTab;
  showInlineTitle: unknown;
  showViewHeader: unknown;
  theme: string;
}
const contextId = new ContextId<RuntimeContext>();
const FIXTURE = `---
root: original
flat.object: flattened
emptyScalar:
emptyList: []
inlineObject: {name: inline}
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
  minimalCss = await evalInObsidian({
    callback: async ({ app, obsidianModule: { requestUrl } }) => {
      const response = await requestUrl('https://raw.githubusercontent.com/kepano/obsidian-minimal/504c2e9c27012f4ea7cc898d242722ee8b795dbc/theme.css');
      const directory = `${app.vault.configDir}/themes/Minimal-runtime`;
      for (const folder of [`${app.vault.configDir}/themes`, directory]) {
        if (!await app.vault.adapter.exists(folder)) {
          await app.vault.adapter.mkdir(folder);
        }
      }
      await app.vault.adapter.write(`${directory}/manifest.json`, JSON.stringify({ author: '@kepano', minAppVersion: '1.9.0', name: 'Minimal-runtime', version: '8.2.2' }));
      await app.vault.adapter.write(`${directory}/theme.css`, response.text);
      return response.text;
    },
    vaultPath: vault.path
  });
  await writeDesktopFixtures(vault.path, { 'property-runtime.md': FIXTURE });
});

beforeEach(async () => {
  await evalInObsidian({
    callback: async ({ app, context, css, fixture, lib: { hoverElement, waitUntil } }) => {
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
      // The harness's input helpers always address the main webContents. Resolve the
      // Actual owner on each input so a moved editor receives trusted native events.
      function send(event: Parameters<Window['electronWindow']['webContents']['sendInputEvent']>[0]): void {
        const owner = context.markdownView.containerEl.win;
        owner.electronWindow.webContents.sendInputEvent(event);
      }
      context.nativeInput = {
        clickElement: ({ element }): void => {
          const rect = element.getBoundingClientRect();
          context.nativeInput.clickMouse({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
        },
        clickMouse: ({ x, y }): void => {
          context.nativeInput.moveMouse({ x, y });
          for (const type of ['mouseDown', 'mouseUp'] as const) {
            send({ button: 'left', clickCount: 1, type, x: Math.round(x), y: Math.round(y) });
          }
        },
        moveMouse: ({ x, y }): void => {
          send({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
        },
        pressKey: ({ key, modifiers = [] }): void => {
          for (const type of ['keyDown', 'char', 'keyUp'] as const) {
            send({ keyCode: key, modifiers: modifiers.map(() => 'control'), type });
          }
        }
      };
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
      await tab.setControlValue('isGloballyControlHoverBreadcrumbTimeoutEnabled', true);
      await tab.setControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds', 0.12);
      for (const mode of ['LivePreview', 'Source', 'Reading']) {
        await tab.setControlValue(`isControl${mode}ModeHoverBreadcrumbTimeoutIndividuallyEnabled`, false);
      }
      // Park the native pointer outside the note before the next traversal. A breadcrumb
      // From its previous position can otherwise cover the input about to be clicked.
      await hoverElement({ element: leaf.tabHeaderEl });
      await waitUntil({ predicate: () => leaf.view.containerEl.ownerDocument.querySelector('.np-property-breadcrumb-popover') === null });
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
      (context as Partial<RuntimeContext>).markdownView?.leaf.detach();
      app.vault.setConfig('showInlineTitle', context.showInlineTitle);
      app.vault.setConfig('showViewHeader', context.showViewHeader);
    },
    contextId,
    vaultPath: vault.path
  });
});

describe('Property interaction surfaces with Minimal and hidden titles', () => {
  it.each([false, true])('activates parent and leaf Source gutters in every scope with popout=%s', async (isPopout) => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { markdownView, nativeInput: { moveMouse }, settingsTab }, lib: { waitUntil }, popoutMode }) => {
        await markdownView.leaf.setViewState({ state: { file: 'property-runtime.md', mode: 'source', source: true }, type: 'markdown' });
        if (popoutMode) {
          const popout = app.workspace.moveLeafToPopout(markdownView.leaf, { size: { height: 1000, width: 1100 } });
          popout.win.electronWindow.focus();
          await waitUntil({ predicate: () => markdownView.containerEl.ownerDocument === popout.doc && popout.doc.hasFocus() });
        }
        const source = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view');
        if (source === null) {
          throw new Error('Source editor missing');
        }
        const doc = source.ownerDocument;
        const failures: object[] = [];
        for (const [field, keyScope] of [[false, false], [false, true], [true, false], [true, true]]) {
          await settingsTab.setControlValue('isFullWidthPropertyFieldHoverActivationEnabled', field);
          await settingsTab.setControlValue('isFullWidthPropertyKeyHoverActivationEnabled', keyScope);
          for (const key of ['root', 'flat.object', 'emptyScalar', 'emptyList', 'inlineObject', 'nested', 'child', 'leaf']) {
            const row = [...source.querySelectorAll<HTMLElement>('.cm-line')].find((line) => line.textContent.trimStart().startsWith(`${key}:`));
            if (row === undefined) {
              throw new Error(`Source row missing: ${key}`);
            }
            const walker = doc.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            let first: DOMRect | undefined;
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const start = node.textContent?.search(/\S/u) ?? -1;
              if (start < 0) {
                continue;
              }
              const range = doc.createRange();
              range.setStart(node, start);
              range.setEnd(node, start + 1);
              first = range.getBoundingClientRect();
              break;
            }
            if (first === undefined) {
              throw new Error(`Source key geometry missing: ${key}`);
            }
            const point = { x: first.left - first.height / 2, y: (first.top + first.bottom) / 2 };
            moveMouse(point);
            await new Promise<void>((resolve) => {
              doc.win.setTimeout(resolve, 200);
            });
            const current = doc.querySelector(':scope .np-property-breadcrumb-popover .is-current button')?.textContent;
            if (current !== key) {
              failures.push({ current: current ?? null, field, key, keyScope, point, target: doc.elementFromPoint(point.x, point.y)?.className });
            }
            const surface = source.getBoundingClientRect();
            moveMouse({ x: surface.right - 4, y: surface.top + 2 });
            await waitUntil({ predicate: () => doc.querySelector('.np-property-breadcrumb-popover') === null });
          }
        }
        return failures;
      },
      contextId,
      input: { popoutMode: isPopout },
      vaultPath: vault.path
    });
    expect(result).toEqual([]);
  });

  it.each(['live-preview', 'source', 'reading'].flatMap((mode) => [false, true].map((popout) => ({ mode, popout }))))('preserves navigation across a slow pointer crossing in $mode with popout=$popout', async ({ mode, popout }) => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { markdownView, nativeInput: { clickElement, moveMouse }, settingsTab }, lib: { waitUntil }, popoutMode, viewMode }) => {
        await markdownView.leaf.setViewState({ state: { file: 'property-runtime.md', mode: viewMode === 'reading' ? 'preview' : 'source', source: viewMode === 'source' }, type: 'markdown' });
        if (popoutMode) {
          const movedWindow = app.workspace.moveLeafToPopout(markdownView.leaf, { size: { height: 1000, width: 1100 } });
          movedWindow.win.electronWindow.focus();
          await waitUntil({ predicate: () => markdownView.containerEl.ownerDocument === movedWindow.doc && movedWindow.doc.hasFocus() });
        }
        const modeKey = viewMode === 'live-preview' ? 'LivePreview' : (viewMode === 'source' ? 'Source' : 'Reading');
        const valueKey = viewMode === 'live-preview' ? 'livePreview' : viewMode;
        await settingsTab.setControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds', 0.01);
        await settingsTab.setControlValue(`isControl${modeKey}ModeHoverBreadcrumbTimeoutIndividuallyEnabled`, true);
        await settingsTab.setControlValue(`${valueKey}ModeHoverBreadcrumbTimeoutSeconds`, 0.6);
        const doc = markdownView.containerEl.ownerDocument;
        function pause(ms: number): Promise<void> {
          return new Promise((resolve) => {
            doc.win.setTimeout(resolve, ms);
          });
        }
        function property(key: string): HTMLElement | undefined {
          return viewMode === 'source'
            ? [...markdownView.containerEl.querySelectorAll<HTMLElement>('.cm-line')].find((line) => line.textContent.trimStart().startsWith(`${key}:`))
            : [...markdownView.containerEl.querySelectorAll<HTMLElement>('.metadata-property-key')].find((element) => (element.querySelector<HTMLInputElement>('.metadata-property-key-input')?.value ?? element.textContent.trim()) === key);
        }
        await waitUntil({ predicate: () => property('leaf') !== undefined });
        const leaf = property('leaf');
        if (leaf === undefined) {
          throw new Error('Leaf field missing');
        }
        const anchor = leaf.getBoundingClientRect();
        const enter = { x: anchor.left + 8, y: (anchor.top + anchor.bottom) / 2 };
        const outside = { x: doc.win.innerWidth - 5, y: 30 };
        moveMouse(enter);
        await waitUntil({ predicate: () => doc.querySelector(':scope .np-property-breadcrumb-popover .is-current button')?.textContent === 'leaf' });
        const panel = doc.querySelector<HTMLElement>('.np-property-breadcrumb-popover');
        if (panel === null) {
          throw new Error('Breadcrumb missing');
        }
        const rect = panel.getBoundingClientRect();
        moveMouse({ x: Math.max(anchor.left, rect.left) + 8, y: (rect.top >= anchor.bottom ? anchor.bottom + rect.top : rect.bottom + anchor.top) / 2 });
        await pause(250);
        const isSameAfterGap = panel.isConnected && doc.querySelector('.np-property-breadcrumb-popover') === panel;
        const ancestor = [...panel.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'nested');
        if (ancestor === undefined) {
          throw new Error('Ancestor navigation button missing');
        }
        const button = ancestor.getBoundingClientRect();
        moveMouse({ x: button.left + 12, y: (button.top + button.bottom) / 2 });
        await pause(700);
        const isStaysInside = panel.isConnected;
        moveMouse(outside);
        await pause(250);
        const isIndividualOverride = panel.isConnected;
        await waitUntil({ predicate: () => !panel.isConnected });
        moveMouse(enter);
        await waitUntil({ predicate: () => doc.querySelector(':scope .np-property-breadcrumb-popover .is-current button')?.textContent === 'leaf' });
        const navigation = [...doc.querySelectorAll<HTMLButtonElement>(':scope .np-property-breadcrumb-popover button')].find((candidate) => candidate.textContent === 'nested');
        if (navigation === undefined) {
          throw new Error('Reopened navigation missing');
        }
        clickElement({ element: navigation });
        await pause(250);
        const isNavigated = viewMode === 'source'
          ? markdownView.editor.getLine(markdownView.editor.getCursor().line).trim() === 'nested:'
          : property('nested')?.contains(doc.activeElement) === true;
        return { individualOverride: isIndividualOverride, navigated: isNavigated, sameAfterGap: isSameAfterGap, staysInside: isStaysInside };
      },
      contextId,
      input: { popoutMode: popout, viewMode: mode },
      vaultPath: vault.path
    });
    expect(result).toEqual({ individualOverride: true, navigated: true, sameAfterGap: true, staysInside: true });
  });

  it('keeps decimal timeout input mounted through typing, Enter, and plugin reload', async () => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { nativeInput: { clickElement, pressKey }, settingsTab }, lib: { waitUntil } }) => {
        app.setting.open();
        app.setting.openTabById('nested-properties-advanced');
        function findInput(tab: PluginSettingTab): HTMLInputElement | null {
          return [...tab.containerEl.querySelectorAll('.setting-item')].find((row) => row.querySelector('.setting-item-name')?.textContent === 'Global Hover Breadcrumb Popover Timeout')?.querySelector('input') ?? null;
        }
        try {
          await waitUntil({ predicate: () => findInput(settingsTab) !== null });
          const input = findInput(settingsTab);
          if (input === null) {
            throw new Error('Timeout number control missing');
          }
          input.scrollIntoView({ block: 'center' });
          clickElement({ element: input });
          await waitUntil({ message: 'Native timeout input did not receive focus', predicate: () => input.ownerDocument.activeElement === input });
          pressKey({ key: 'a', modifiers: ['Ctrl'] });
          const trace: object[] = [];
          for (const eventName of ['keydown', 'input', 'blur']) {
            input.addEventListener(eventName, (event) => {
              trace.push({ key: (event as KeyboardEvent).key, type: event.type, value: input.value });
            });
          }
          for (const key of '2.75') {
            pressKey({ key });
            await new Promise<void>((resolve) => {
              input.win.setTimeout(resolve, 40);
            });
          }
          pressKey({ key: 'Enter' });
          try {
            await waitUntil({ predicate: () => settingsTab.getControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds') === 2.75 });
          } catch (error) {
            throw new Error(`Native timeout entry failed: ${JSON.stringify({ active: input.ownerDocument.activeElement?.outerHTML.slice(0, 500), input: input.outerHTML, persisted: settingsTab.getControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds'), trace, value: input.value })}`, { cause: error });
          }
          const value = input.value;
          const isSameInput = findInput(settingsTab) === input && input.isConnected;
          const type = input.type;
          app.setting.close();
          await app.plugins.disablePlugin('nested-properties-advanced');
          await app.plugins.enablePlugin('nested-properties-advanced');
          const reloaded = app.setting.pluginTabs.find((tab) => tab.id === 'nested-properties-advanced');
          if (reloaded === undefined) {
            throw new Error('Reloaded settings missing');
          }
          return { persisted: reloaded.getControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds'), sameInput: isSameInput, type, value };
        } finally {
          app.setting.close();
        }
      },
      contextId,
      vaultPath: vault.path
    });
    expect(result).toEqual({ persisted: 2.75, sameInput: true, type: 'number', value: '2.75' });
  });

  it.each([false, true].flatMap((isSource) => ['main', 'popout', 'reload', 'popout-reload'].map((lifecycle) => ({ isSource, lifecycle }))))('sweeps root, flattened and nested rows with Source=$isSource after $lifecycle', async ({ isSource, lifecycle }) => {
    const result = await evalInObsidian({
      // eslint-disable-next-line complexity -- The serialized desktop callback compares all regions in one pointer traversal.
      callback: async ({ app, context: { markdownView, nativeInput: { moveMouse }, settingsTab: originalSettingsTab }, isSourceMode, lib: { waitUntil }, lifecycleMode }) => {
        await markdownView.leaf.setViewState({ state: { file: 'property-runtime.md', mode: 'source', source: isSourceMode }, type: 'markdown' });
        let settingsTab = originalSettingsTab;
        if (lifecycleMode.startsWith('popout')) {
          const popout = app.workspace.moveLeafToPopout(markdownView.leaf, { size: { height: 1000, width: 1100 } });
          popout.win.electronWindow.focus();
          await waitUntil({ predicate: () => markdownView.containerEl.ownerDocument === popout.doc && popout.doc.hasFocus() });
        }
        if (lifecycleMode.endsWith('reload')) {
          await app.plugins.disablePlugin('nested-properties-advanced');
          await app.plugins.enablePlugin('nested-properties-advanced');
          const tab = app.setting.pluginTabs.find((candidate) => candidate.id === 'nested-properties-advanced');
          if (tab === undefined) {
            throw new Error('Reloaded settings missing');
          }
          settingsTab = tab;
        }
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
          for (const key of ['root', 'flat.object', 'emptyScalar', 'emptyList', 'inlineObject', 'nested', 'child', 'leaf']) {
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
                const target = doc.elementFromPoint(x, y);
                failures.push({ current: current ?? null, key, ownerRealmElement: target instanceof win.Element, scope, target: target?.className, x, y });
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
      input: { isSourceMode: isSource, lifecycleMode: lifecycle },
      vaultPath: vault.path
    });
    expect(result).toEqual([]);
  });

  it.each(['root', 'leaf'].flatMap((key) => ['key', 'value'].flatMap((kind) => ['padding', 'breadcrumb', 'popout', 'popout-row'].map((focus) => ({ focus, key, kind })))))('keeps native redo after $key $kind edit, Escape and $focus interaction', async ({ focus, key, kind }) => {
    const result = await evalInObsidian({
      // eslint-disable-next-line complexity -- Keep the native focus sequence and its failure trace in the same serialized callback.
      callback: async ({ app, context: { markdownView, nativeInput: { clickElement, clickMouse, moveMouse, pressKey } }, focusTarget, inputKind, keyName, lib: { waitUntil } }) => {
        if (focusTarget.startsWith('popout')) {
          const popout = app.workspace.moveLeafToPopout(markdownView.leaf, { size: { height: 1000, width: 1100 } });
          popout.win.electronWindow.focus();
          await waitUntil({ predicate: () => markdownView.containerEl.ownerDocument === popout.doc && popout.doc.hasFocus() });
          moveMouse({ x: 20, y: 20 });
        }
        const source = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view');
        const keyInput = [...markdownView.containerEl.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((candidate) => candidate.value === keyName);
        const input = inputKind === 'key' ? keyInput : keyInput?.closest('.metadata-property')?.querySelector<HTMLElement>(':scope > .metadata-property-value [contenteditable="true"]');
        const scroller = source?.querySelector<HTMLElement>('.cm-scroller');
        if (source === null || input === undefined || input === null || scroller === undefined || scroller === null) {
          throw new Error('History surface missing');
        }
        const activeScroller = scroller;
        const editedInput = input;
        const activeSource = source;
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

        const text = inputKind === 'key' ? `${keyName}Changed` : 'updated';
        const after = inputKind === 'key' ? `${keyName}Changed:` : `${keyName}: updated`;
        const before = inputKind === 'key' ? `${keyName}:` : `${keyName}: ${keyName === 'root' ? 'original' : 'value'}`;
        clickElement({ element: input });
        await waitForFocus('The property input did not receive the click', () => source.ownerDocument.activeElement === input);
        pressKey({ key: 'a', modifiers: ['Ctrl'] });
        for (const character of text) {
          pressKey({ key: character });
        }
        await waitUntil({ message: 'Typing did not reach the property input', predicate: () => (input.instanceOf(HTMLInputElement) ? input.value : input.textContent) === text });
        pressKey({ key: 'Enter' });
        await waitUntil({ message: 'Enter did not commit the property edit', predicate: () => markdownView.editor.getValue().includes(after) });
        await waitUntil({
          message: 'Enter did not hand focus to the property value or row',
          predicate: () =>
            inputKind === 'key' && input.closest('.nested-properties-container') === null
              ? source.ownerDocument.activeElement?.closest('.metadata-property-value') !== null && source.ownerDocument.activeElement !== input
              : !source.ownerDocument.activeElement?.matches('input, textarea, [contenteditable="true"]')
        });
        pressKey({ key: 'Escape' });
        await waitForFocus('Escape did not leave the property input', () => !source.ownerDocument.activeElement?.matches('input, textarea, [contenteditable="true"]'));
        const sourceRect = source.getBoundingClientRect();
        if (focusTarget !== 'popout-row') {
          clickMouse({ x: sourceRect.right - 30, y: sourceRect.top + 80 });
        }
        const doc = source.ownerDocument;
        const focusBeforeUndo = doc.activeElement?.className;
        const scrollTop = scroller.scrollTop;
        let maximumScrollDelta = 0;
        function measureScroll(): void {
          maximumScrollDelta = Math.max(maximumScrollDelta, Math.abs(activeScroller.scrollTop - scrollTop));
        }
        scroller.addEventListener('scroll', measureScroll);
        pressKey({ key: 'z', modifiers: ['Ctrl'] });
        await waitUntil({ message: `Undo failed with focus on ${String(focusBeforeUndo)}`, predicate: () => markdownView.editor.getValue().includes(before) });
        await new Promise<void>((resolve) => {
          doc.defaultView?.setTimeout(resolve, 2500);
        });
        if (focusTarget === 'breadcrumb') {
          const restored = [...source.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((candidate) => candidate.value === keyName);
          if (restored === undefined) {
            throw new Error('Undone property did not render');
          }
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
        measureScroll();
        scroller.removeEventListener('scroll', measureScroll);
        return { focusBeforeRedo, focusBeforeUndo, isRedone: markdownView.editor.getValue().includes(after), maximumScrollDelta };
      },
      contextId,
      input: { focusTarget: focus, inputKind: kind, keyName: key },
      vaultPath: vault.path
    });
    expect(result.isRedone, JSON.stringify(result)).toBe(true);
    expect(result.maximumScrollDelta, JSON.stringify(result)).toBeLessThanOrEqual(2);
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

  it.each([false, true].flatMap((isSource) => [false, true].map((isPopout) => ({ isPopout, isSource }))))('activates each threading mode across root and nested rows with Source=$isSource in popout=$isPopout', async ({ isPopout, isSource }) => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { markdownView, nativeInput: { clickMouse, moveMouse }, settingsTab }, isPopoutWindow, isSourceMode, lib: { waitUntil } }) => {
        await settingsTab.setControlValue('isPropertyFieldHoverBreadcrumbEnabled', false);
        await settingsTab.setControlValue('isActiveRootLevelPropertyFieldTreeThreadingEnabled', true);
        await settingsTab.setControlValue('isAllBranchesOfActiveRootLevelPropertyFieldTreeThreadingEnabled', false);
        await markdownView.leaf.setViewState({ state: { file: 'property-runtime.md', mode: 'source', source: isSourceMode }, type: 'markdown' });
        if (isPopoutWindow) {
          const popout = app.workspace.moveLeafToPopout(markdownView.leaf, { size: { height: 1000, width: 1100 } });
          popout.win.electronWindow.focus();
          await waitUntil({ predicate: () => markdownView.containerEl.ownerDocument === popout.doc && popout.doc.hasFocus() });
        }
        const source = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view');
        if (source === null) {
          throw new Error('Threading surface missing');
        }
        await waitUntil({ predicate: () => source.classList.contains('is-live-preview') !== isSourceMode });
        const failures: object[] = [];
        for (const mode of ['active', 'all', 'root', 'cursor']) {
          await settingsTab.setControlValue('isActiveCursorPropertyFieldThreadingEnabled', mode === 'cursor');
          await settingsTab.setControlValue('isActivePropertyFieldThreadingEnabled', mode === 'active' || mode === 'cursor');
          await settingsTab.setControlValue('isAllBranchesOfActivePropertyFieldTreeThreadingEnabled', mode === 'all');
          await settingsTab.setControlValue('isActiveRootLevelPropertyFieldThreadingEnabled', mode === 'root');
          for (const key of ['root', 'leaf']) {
            const row = isSourceMode
              ? [...source.querySelectorAll<HTMLElement>('.cm-line')].find((line) => line.textContent.trimStart().startsWith(`${key}:`))
              : [...source.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((input) => input.value === key);
            if (row === undefined) {
              throw new Error('Threading row missing');
            }
            const rect = row.getBoundingClientRect();
            const surface = source.getBoundingClientRect();
            for (const x of [surface.left + 4, rect.left + 12, surface.right - 24]) {
              const point = { x, y: (rect.top + rect.bottom) / 2 };
              if (mode === 'cursor') {
                clickMouse(point);
              } else {
                moveMouse(point);
              }
              await new Promise<void>((resolve) => {
                source.ownerDocument.defaultView?.setTimeout(resolve, 100);
              });
              const active = isSourceMode
                ? source.querySelector('.np-property-field-source-highlight')?.textContent.trimStart().startsWith(`${key}:`)
                : source.querySelector<HTMLInputElement>(':scope .np-property-field-active .metadata-property-key-input')?.value === key;
              const hasThread = [...source.querySelectorAll<SVGPathElement>('.np-property-thread-active, .np-property-thread-all, .np-property-thread-root-active')].some((path) => {
                const style = source.ownerDocument.defaultView?.getComputedStyle(path);
                return path.getClientRects().length > 0 && path.getTotalLength() > 0 && style?.visibility === 'visible'
                  && style.stroke !== 'none' && Number.parseFloat(style.strokeOpacity) > 0 && Number.parseFloat(style.strokeWidth) > 0;
              });
              if (!active || !hasThread) {
                failures.push({ active, hasThread, key, mode, x });
              }
            }
          }
        }
        return failures;
      },
      contextId,
      input: { isPopoutWindow: isPopout, isSourceMode: isSource },
      vaultPath: vault.path
    });
    expect(result).toEqual([]);
  });

  it('activates every rendered fragment of a wrapped Source key', async () => {
    const isResult = await evalInObsidian({
      callback: async ({ context: { markdownView, settingsTab }, lib: { moveMouse, waitUntil } }) => {
        const key = 'A long property key with enough words to wrap across the editor width '.repeat(3).trim();
        markdownView.editor.setValue(markdownView.editor.getValue().replace('root: original', () => `${key}: original`));
        await markdownView.leaf.setViewState({ state: { file: 'property-runtime.md', mode: 'source', source: true }, type: 'markdown' });
        await settingsTab.setControlValue('isFullWidthPropertyFieldHoverActivationEnabled', false);
        await settingsTab.setControlValue('isFullWidthPropertyKeyHoverActivationEnabled', true);
        const source = markdownView.containerEl.querySelector<HTMLElement>('.markdown-source-view');
        if (source === null) {
          throw new Error('Wrapped Source fixture missing');
        }
        await waitUntil({ predicate: () => !source.classList.contains('is-live-preview') });
        const line = [...source.querySelectorAll<HTMLElement>('.cm-line')].find((element) => element.textContent.startsWith(key));
        if (line === undefined) {
          throw new Error('Wrapped Source line missing');
        }
        const doc = source.ownerDocument;
        const range = doc.createRange();
        range.selectNodeContents(line);
        const fragments = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
        const top = Math.min(...fragments.map((rect) => rect.top));
        const firstLine = fragments.filter((rect) => rect.top === top).sort((left, right) => right.right - left.right)[0];
        if (firstLine === undefined || new Set(fragments.map((rect) => rect.top)).size < 2) {
          throw new Error('Source key did not wrap');
        }
        moveMouse({ x: firstLine.right - 4, y: (firstLine.top + firstLine.bottom) / 2 });
        await new Promise<void>((resolve) => {
          doc.defaultView?.setTimeout(resolve, 180);
        });
        return doc.querySelector(':scope .np-property-breadcrumb-popover .is-current button')?.textContent === key;
      },
      contextId,
      vaultPath: vault.path
    });
    expect(isResult).toBe(true);
  });
});
