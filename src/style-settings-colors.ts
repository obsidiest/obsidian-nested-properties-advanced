/* eslint-disable func-style, no-magic-numbers -- Preserve the reference dialog event flow; numeric literals describe hex/RGBA channel formats. */
// Adapted from obsidiest/obsidian-list-tree-indentation-guides 2.0.2 (MIT), src/style-settings-colors.ts.
import type { App } from 'obsidian';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { noopAsync } from 'obsidian-dev-utils/function';

const SECTION = 'nested-properties-advanced';
export const THEMED_COLOR_DEFAULTS = new Map<string, readonly [string, string]>([
  ['np-active-field-color', ['#4c78cc', '#7aa2f7']],
  ['np-active-tree-background-color', ['#6b6b6b', '#000000']],
  ['np-active-tree-outline-color', ['#333333', '#8a8a8a']],
  ['np-breadcrumb-background', ['#ffffff', '#202225']],
  ['np-breadcrumb-border-color', ['#d7d7d7', '#46484d']],
  ['np-breadcrumb-current-color', ['#4c78cc', '#7aa2f7']],
  ['np-breadcrumb-hover-color', ['#e7edf8', '#343b4a']],
  ['np-breadcrumb-text-color', ['#252525', '#dcddde']],
  ['np-breadcrumb-title-color', ['#666666', '#a7a9ad']],
  ['np-guide-color', ['#777777', '#888888']],
  ['np-thread-color-1', ['#d94f00', '#ff5a00']],
  ['np-thread-color-2', ['#c99a00', '#ffc400']],
  ['np-thread-color-3', ['#79b800', '#a8e600']],
  ['np-thread-color-4', ['#008ea1', '#00c8df']],
  ['np-thread-color-5', ['#396fc8', '#5794ff']],
  ['np-thread-color-6', ['#7046bf', '#a66cff']],
  ['np-thread-color-7', ['#b33478', '#e64fa3']],
  ['np-thread-color-8', ['#8d4cb8', '#cb74ff']]
]);

/** Narrow, feature-detected integration with Style Settings 1.0.9's manager.
 * Keep its schema and @@light/@@dark keys so existing values/export/import work.
 * setSettings returns save()'s promise; setSetting's Pickr callback does not. */
export interface StyleSettingsColorStore {
  getSetting(section: string, id: string): unknown;
  setSettings(values: Record<string, string>): Promise<void>;
}
interface ColorRow {
  controls: HTMLElement;
  original: HTMLElement;
  row: HTMLElement;
  sync(): void;
}

interface ColorStorePlugin {
  settingsManager?: Partial<StyleSettingsColorStore>;
}

export class StyleSettingsColors {
  private readonly dialogs = new Map<Document, HTMLDialogElement>();
  private readonly rows = new Map<HTMLElement, ColorRow>();
  public constructor(private readonly getStore: () => null | StyleSettingsColorStore) {}

  public enhance(doc: Document): void {
    for (const [row, record] of this.rows) {
      if (!row.isConnected) {
        this.restore(record);
        this.rows.delete(row);
      } else if (row.ownerDocument === doc) {
        record.sync();
      }
    }
    const store = this.getStore();
    if (!store) {
      return;
    }
    for (const row of doc.querySelectorAll<HTMLElement>('.setting-item[data-id]')) {
      if (this.rows.has(row)) {
        continue;
      }
      const id = (row.dataset['id'] ?? '').replace(`${SECTION}@@`, '');
      const defaults = THEMED_COLOR_DEFAULTS.get(id);
      const original = row.querySelector<HTMLElement>('.themed-color-wrapper');
      const control = row.querySelector<HTMLElement>('.setting-item-control');
      if (!defaults || !original || !control) {
        continue;
      }
      const name = row.querySelector('.setting-item-name')?.textContent ?? 'Color';
      const controls = control.createDiv({ cls: 'np-style-color-controls' });
      const updates: (() => void)[] = [];
      for (const theme of ['light', 'dark']) {
        const fallback = defaults[theme === 'light' ? 0 : 1], key = `${id}@@${theme}`;
        const title = `${name} (${theme})`;
        const button = controls.createEl('button', { attr: { 'aria-label': `${title} picker`, 'type': 'button' }, cls: 'np-style-color-swatch', text: theme === 'light' ? 'Light' : 'Dark' });
        const value = (): string => savedColorHex(store.getSetting(SECTION, key)) ?? fallback;
        const sync = (): void => {
          button.style.setProperty('--np-chosen-color', value());
          button.title = `${title}: ${value()}`;
        };
        button.addEventListener('click', () => {
          this.open(doc, title, key, value(), fallback, sync);
        });
        updates.push(sync);
      }
      // Leave the upstream component owned by Style Settings; only replace its
      // Presentation. Unload restores it, without monkey-patching Pickr itself.
      original.classList.add('np-style-color-original');
      const sync = (): void => {
        for (const update of updates) {
          update();
        }
      };
      this.rows.set(row, { controls, original, row, sync });
      sync();
    }
  }

  public removeDocument(doc: Document): void {
    this.dialogs.get(doc)?.close();
    for (const [row, record] of this.rows) {
      if (row.ownerDocument !== doc) {
        continue;
      }

      this.restore(record);
      this.rows.delete(row);
    }
  }

  public stop(): void {
    for (const dialog of this.dialogs.values()) {
      dialog.close();
    }
    for (const record of this.rows.values()) {
      this.restore(record);
    }
    this.rows.clear();
  }

  private open(doc: Document, title: string, key: string, initial: string, fallback: string, sync: () => void): void {
    this.dialogs.get(doc)?.close();
    const dialog = doc.body.createEl('dialog', { attr: { 'aria-label': title }, cls: 'np-color-dialog' });
    this.dialogs.set(doc, dialog);
    dialog.createEl('h3', { text: title });
    const form = dialog.createEl('form');
    const fields = form.createDiv({ cls: 'np-color-dialog-fields' });
    const picker = fields.createEl('input', { attr: { 'aria-label': 'Choose color' }, type: 'color' });
    const text = fields.createEl('input', { attr: { 'aria-label': 'Hex color', 'spellcheck': 'false' }, type: 'text' });
    const status = form.createDiv({ attr: { role: 'status' }, cls: 'np-color-dialog-status' });
    const actions = form.createDiv({ cls: 'np-color-dialog-actions' });
    const reset = actions.createEl('button', { attr: { type: 'button' }, text: 'Default' });
    const cancel = actions.createEl('button', { attr: { type: 'button' }, text: 'Cancel' });
    const save = actions.createEl('button', { attr: { type: 'submit' }, cls: 'mod-cta', text: 'Save' });
    const set = (value: string): void => {
      text.value = value;
      picker.value = value.slice(0, 7);
    };
    set(initial);
    text.addEventListener('input', () => {
      const hex = pickerHex(text.value);
      if (hex) {
        picker.value = hex.slice(0, 7);
      }
      text.removeAttribute('aria-invalid');
      status.textContent = '';
    });
    picker.addEventListener('input', () => {
      set(picker.value + (pickerHex(text.value)?.slice(7) ?? ''));
    });
    reset.addEventListener('click', () => {
      set(fallback);
    });
    cancel.addEventListener('click', () => {
      dialog.close();
    });
    let isSaving = false;
    dialog.addEventListener('cancel', (event) => {
      if (isSaving) {
        event.preventDefault();
      }
    });
    dialog.addEventListener('close', () => {
      if (this.dialogs.get(doc) === dialog) {
        this.dialogs.delete(doc);
      }
      dialog.remove();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isSaving) {
        return;
      }
      const hex = pickerHex(text.value), store = this.getStore();
      if (!hex || !store) {
        status.textContent = hex ? 'Enable Style Settings to save this color.' : 'Enter a hex color, such as #7aa2f7.';
        text.setAttribute('aria-invalid', 'true');
        return;
      }
      isSaving = true;
      for (const control of [picker, text, reset, cancel, save]) {
        control.disabled = true;
      }
      status.textContent = 'Saving…';
      // Preserve the original Style Settings storage keys and await both disk
      // Persistence and CSS regeneration before reporting success/closing.
      invokeAsyncSafely(() =>
        noopAsync().then(() => store.setSettings(colorUpdates(store, key, hex))).then(() => {
          sync();
          dialog.close();
        }).catch((error: unknown) => {
          isSaving = false;
          for (const control of [picker, text, reset, cancel, save]) {
            control.disabled = false;
          }
          status.textContent = 'Could not save the color. Please try again.';
          console.error('Nested Properties Advanced: color save failed', error);
        })
      );
    });
    dialog.showModal();
    text.focus();
    text.select();
  }

  private restore(record: ColorRow): void {
    record.controls.remove();
    record.original.classList.remove('np-style-color-original');
  }
}

export function pickerHex(value: unknown): null | string {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value.trim().toLowerCase();
  if (/^#[\da-f]{3,4}$/.test(hex)) {
    return `#${hex.slice(1).replaceAll(/[a-f0-9]/gu, '$&$&')}`;
  }
  return /^#(?:[\da-f]{6}|[\da-f]{8})$/.test(hex) ? hex : null;
}

export function styleSettingsColorStore(app: App): null | StyleSettingsColorStore {
  const plugin = app.plugins.getPlugin('obsidian-style-settings') as ColorStorePlugin | undefined;
  const manager = plugin?.settingsManager;
  return typeof manager?.getSetting === 'function' && typeof manager.setSettings === 'function'
    ? manager as StyleSettingsColorStore
    : null;
}

function colorUpdates(store: StyleSettingsColorStore, key: string, hex: string): Record<string, string> {
  const updates: Record<string, string> = {};
  // Pickr can leave a malformed hex/non-finite color behind. Style Settings
  // 1.0.9 parses every themed color when saving, so one such value blocks CSS
  // Generation even when editing a different field. Repair only known-bad
  // Values in our own controls; preserve valid colors and other plugins' data.
  for (const [id, defaults] of THEMED_COLOR_DEFAULTS) {
    for (const theme of ['light', 'dark']) {
      const storedKey = `${id}@@${theme}`, value = store.getSetting(SECTION, storedKey);
      if (typeof value === 'string' && ((value.trimStart().startsWith('#') && !pickerHex(value)) || /NaN|Infinity/i.test(value))) {
        updates[`${SECTION}@@${storedKey}`] = defaults[theme === 'light' ? 0 : 1];
      }
    }
  }
  updates[`${SECTION}@@${key}`] = hex;
  return updates;
}

function savedColorHex(value: unknown): null | string {
  const hex = pickerHex(value);
  if (hex || typeof value !== 'string') {
    return hex;
  }
  // Style Settings imports can contain RGB/HSL or named colors. Convert their
  // Display value without rewriting the saved setting until the user saves.
  if (!/^(?:rgba?|hsla?)\(|^[a-z]+$/i.test(value.trim()) || !CSS.supports('color', value)) {
    return null;
  }
  const context = createFragment().createEl('canvas').getContext('2d');
  if (!context) {
    return null;
  }
  context.fillStyle = value;
  const normalized = context.fillStyle;
  const direct = pickerHex(normalized);
  if (direct) {
    return direct;
  }
  const channels = normalized.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) {
    return null;
  }
  return `#${channels.map((channel, index) => Math.round(index === 3 ? channel * 255 : channel).toString(16).padStart(2, '0')).join('')}`;
}

/* eslint-enable func-style, no-magic-numbers -- End of adapted dialog code. */
