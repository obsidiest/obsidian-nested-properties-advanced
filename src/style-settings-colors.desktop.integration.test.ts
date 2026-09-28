import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

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
  it.each(['light', 'dark'])('persists %s in the original storage key, applies CSS, closes and reopens', async (theme) => {
    const result = await evalInObsidian({
      callback: async ({ app, lib: { clickElement, waitUntil }, themeName }) => {
        app.setting.open();
        app.setting.openTabById('obsidian-style-settings');
        const doc = app.setting.containerEl.ownerDocument;
        await waitUntil({ predicate: () => doc.querySelector('.style-settings-heading[data-id="nested-properties-advanced"]') !== null });
        for (const heading of doc.querySelectorAll<HTMLElement>('.style-settings-heading.is-collapsed')) {
          heading.click();
        }
        await waitUntil({ message: 'Themed controls were not adapted', predicate: () => doc.querySelector(':scope [data-id$="np-guide-color"] .np-style-color-swatch') !== null });
        const buttons = doc.querySelectorAll<HTMLButtonElement>(':scope [data-id$="np-guide-color"] .np-style-color-swatch');
        const button = buttons[themeName === 'light' ? 0 : 1];
        if (button === undefined) {
          throw new Error('Guide color picker missing');
        }
        button.scrollIntoView({ block: 'center' });
        clickElement({ element: button });
        await waitUntil({ predicate: () => doc.querySelector('dialog.np-color-dialog[open]') !== null });
        const input = doc.querySelector<HTMLInputElement>(':scope .np-color-dialog input[aria-label="Hex color"]');
        const save = doc.querySelector<HTMLButtonElement>(':scope .np-color-dialog button[type="submit"]');
        if (input === null || save === null) {
          throw new Error('Color dialog missing');
        }
        const initial = input.value;
        const color = themeName === 'light' ? '#ab44ee' : '#13163c';
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        clickElement({ element: save });
        await waitUntil({ message: 'Color dialog did not close after Save', predicate: () => doc.querySelector('.np-color-dialog') === null });
        const stored = JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/plugins/obsidian-style-settings/data.json`)) as Record<string, unknown>;
        const sample = doc.body.createDiv({ cls: `theme-${themeName}` });
        const applied = doc.defaultView?.getComputedStyle(sample).getPropertyValue('--np-guide-color').trim();
        sample.remove();
        clickElement({ element: button });
        await waitUntil({ predicate: () => doc.querySelector('.np-color-dialog[open]') !== null });
        const reopened = doc.querySelector<HTMLInputElement>(':scope .np-color-dialog input[aria-label="Hex color"]')?.value;
        doc.querySelector<HTMLDialogElement>('.np-color-dialog')?.close();
        app.setting.close();
        return { applied, color, initial, reopened, stored: stored[`nested-properties-advanced@@np-guide-color@@${themeName}`] };
      },
      input: { themeName: theme },
      vaultPath: vault.path
    });
    expect(result.initial).toBe(theme === 'light' ? '#777777' : '#888888');
    expect(result.stored).toBe(result.color);
    expect(result.applied).toBe(result.color);
    expect(result.reopened).toBe(result.color);
  });
});
