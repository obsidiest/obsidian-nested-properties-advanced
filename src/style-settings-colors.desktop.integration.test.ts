import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

interface ColorStoreMethods {
  getSetting?: unknown;
  setSettings?: unknown;
}

interface ColorStorePlugin {
  settingsManager?: ColorStoreMethods;
}

interface SettingsWindowConfig {
  getConfig(key: 'settingsPopoutWindow'): boolean;
  setConfig(key: 'settingsPopoutWindow', isEnabled: boolean): void;
}

const vault = getTemporaryVault();

beforeAll(async () => {
  await evalInObsidian({
    callback: async ({ app, obsidianModule: { requestUrl } }) => {
      const directory = `${app.vault.configDir}/plugins/obsidian-style-settings`;
      if (!await app.vault.adapter.exists(directory)) {
        await app.vault.adapter.mkdir(directory);
      }
      for (const name of ['main.js', 'manifest.json', 'styles.css']) {
        const response = await requestUrl(`https://github.com/community-archive/obsidian-style-settings/releases/download/1.0.9/${name}`);
        await app.vault.adapter.write(`${directory}/${name}`, response.text);
      }
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin('obsidian-style-settings');
    },
    vaultPath: vault.path
  });
});

afterAll(async () => {
  await evalInObsidian({
    callback: async ({ app }) => {
      app.setting.close();
      await app.plugins.disablePlugin('obsidian-style-settings');
    },
    vaultPath: vault.path
  });
});

describe('color dialogs with released Style Settings 1.0.9 in Obsidian', () => {
  it.each([false, true].flatMap((popout) => ['light', 'dark'].map((theme) => ({ popout, theme }))))('persists $theme, applies CSS, closes and reopens with settings popout=$popout', async ({ popout, theme }) => {
    const result = await evalInObsidian({
      // eslint-disable-next-line complexity -- Keep native window setup, diagnostics and cleanup in one serialized callback.
      callback: async ({ app, isPopout, lib: { waitUntil }, themeName }) => {
        const config = app.vault as SettingsWindowConfig & typeof app.vault;
        const isPreviousPopout = config.getConfig('settingsPopoutWindow');
        app.setting.close();
        config.setConfig('settingsPopoutWindow', isPopout);
        try {
          app.setting.open();
          app.setting.openTabById('obsidian-style-settings');
          const tab = app.setting.pluginTabs.find((candidate) => candidate.id === 'obsidian-style-settings');
          if (tab === undefined) {
            throw new Error('Style Settings tab missing');
          }
          // Opening Settings may asynchronously adopt its content into a popout.
          // Wait for the requested window and rendered tab before capturing its document.
          await waitUntil({
            message: 'Plugin Style Settings heading did not appear in the requested window',
            predicate: () =>
              tab.containerEl.isConnected
              && (tab.containerEl.ownerDocument === app.workspace.rootSplit.doc) === !isPopout
              && tab.containerEl.querySelector('.style-settings-heading[data-id="nested-properties-advanced"]') !== null
          });
          const doc = tab.containerEl.ownerDocument;
          async function clickElement(element: HTMLElement): Promise<void> {
            const owner = element.win;
            owner.electronWindow.focus();
            await waitUntil({ message: 'Color Settings window did not receive focus', predicate: () => element.ownerDocument.hasFocus() });
            element.scrollIntoView({ block: 'center' });
            const rect = element.getBoundingClientRect();
            const point = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
            owner.electronWindow.webContents.sendInputEvent({ type: 'mouseMove', ...point });
            for (const type of ['mouseDown', 'mouseUp'] as const) {
              owner.electronWindow.webContents.sendInputEvent({ button: 'left', clickCount: 1, type, ...point });
            }
          }
          for (const heading of tab.containerEl.querySelectorAll<HTMLElement>('.style-settings-heading.is-collapsed')) {
            heading.click();
          }
          try {
            await waitUntil({ message: 'Themed controls were not adapted', predicate: () => doc.querySelector(':scope [data-id$="np-guide-color"] .np-style-color-swatch') !== null });
          } catch (error) {
            const plugin = app.plugins.getPlugin('obsidian-style-settings') as ColorStorePlugin | undefined;
            const guide = [...tab.containerEl.querySelectorAll('.setting-item')].find((row) => row.querySelector('.setting-item-name')?.textContent === 'Guide color');
            throw new Error(
              `Color integration state: ${
                JSON.stringify({
                  documentMoved: doc !== tab.containerEl.ownerDocument,
                  guide: guide?.outerHTML,
                  headings: [...tab.containerEl.querySelectorAll<HTMLElement>('.style-settings-heading')].map((heading) => ({ classes: heading.className, id: heading.dataset.id })),
                  isMainDocument: doc === app.workspace.rootSplit.doc,
                  managerGet: typeof plugin?.settingsManager?.getSetting,
                  managerSet: typeof plugin?.settingsManager?.setSettings,
                  numberControls: doc.querySelectorAll('.np-style-settings-number-input').length
                })
              }`,
              { cause: error }
            );
          }
          const buttons = doc.querySelectorAll<HTMLButtonElement>(':scope [data-id$="np-guide-color"] .np-style-color-swatch');
          const button = buttons[themeName === 'light' ? 0 : 1];
          if (button === undefined) {
            throw new Error('Guide color picker missing');
          }
          await clickElement(button);
          await waitUntil({ message: 'Native click did not open color dialog', predicate: () => doc.querySelector('dialog.np-color-dialog[open]') !== null });
          const input = doc.querySelector<HTMLInputElement>(':scope .np-color-dialog input[aria-label="Hex color"]');
          const save = doc.querySelector<HTMLButtonElement>(':scope .np-color-dialog button[type="submit"]');
          if (input === null || save === null) {
            throw new Error('Color dialog missing');
          }
          const initial = input.value;
          const color = isPopout ? (themeName === 'light' ? '#cd66bb' : '#332222') : (themeName === 'light' ? '#ab44ee' : '#13163c');
          input.value = color;
          const EventConstructor = input.ownerDocument.defaultView?.Event ?? Event;
          input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
          await clickElement(save);
          await waitUntil({ message: 'Color dialog did not close after Save', predicate: () => doc.querySelector('.np-color-dialog') === null });
          const stored = JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/plugins/obsidian-style-settings/data.json`)) as Record<string, unknown>;
          // Style Settings targets body.theme-*.css-settings-manager. Check the
          // Note window's real body, where property guides inherit this variable.
          const noteDocument = app.workspace.rootSplit.doc;
          const body = noteDocument.body;
          const wasLight = body.classList.contains('theme-light');
          const wasDark = body.classList.contains('theme-dark');
          let applied: string | undefined;
          try {
            body.classList.toggle('theme-light', themeName === 'light');
            body.classList.toggle('theme-dark', themeName === 'dark');
            applied = noteDocument.defaultView?.getComputedStyle(body).getPropertyValue('--np-guide-color').trim();
          } finally {
            body.classList.toggle('theme-light', wasLight);
            body.classList.toggle('theme-dark', wasDark);
          }
          await clickElement(button);
          await waitUntil({ predicate: () => doc.querySelector('.np-color-dialog[open]') !== null });
          const reopened = doc.querySelector<HTMLInputElement>(':scope .np-color-dialog input[aria-label="Hex color"]')?.value;
          doc.querySelector<HTMLDialogElement>('.np-color-dialog')?.close();
          app.setting.close();
          return { applied, color, initial, reopened, stored: stored[`nested-properties-advanced@@np-guide-color@@${themeName}`] };
        } finally {
          app.setting.close();
          config.setConfig('settingsPopoutWindow', isPreviousPopout);
        }
      },
      input: { isPopout: popout, themeName: theme },
      vaultPath: vault.path
    });
    expect(result.initial).toBe(popout ? (theme === 'light' ? '#ab44ee' : '#13163c') : (theme === 'light' ? '#777777' : '#888888'));
    expect(result.stored).toBe(result.color);
    expect(result.applied).toBe(result.color);
    expect(result.reopened).toBe(result.color);
  });
});
