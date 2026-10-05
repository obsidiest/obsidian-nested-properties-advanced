import { noopAsync } from 'obsidian-dev-utils/function';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  StyleSettingsColors,
  THEMED_COLOR_DEFAULTS
} from './style-settings-colors.ts';

interface ColorFixture {
  colors: StyleSettingsColors;
  original: HTMLElement;
  saved: Map<string, string>;
  setSettings: ReturnType<typeof vi.fn<(values: Record<string, string>) => Promise<void>>>;
}

function createFixture(): ColorFixture {
  const saved = new Map<string, string>();
  const setSettings = vi.fn((values: Record<string, string>): Promise<void> => {
    for (const [key, value] of Object.entries(values)) {
      saved.set(key, value);
    }
    return noopAsync();
  });
  const colors = new StyleSettingsColors(() => ({
    getSetting: (section, id): unknown => saved.get(`${section}@@${id}`),
    setSettings
  }));
  const row = document.body.createDiv({ cls: 'setting-item' });
  row.dataset['id'] = 'nested-properties-advanced@@np-guide-color';
  row.createDiv({ cls: 'setting-item-name', text: 'Guide color' });
  const original = row.createDiv({ cls: 'setting-item-control' }).createDiv({ cls: 'themed-color-wrapper' });
  colors.enhance(document);
  return { colors, original, saved, setSettings };
}

function openDialog(theme = 'light'): HTMLDialogElement {
  requireElement<HTMLButtonElement>(`button[aria-label="Guide color (${theme}) picker"]`).click();
  return requireElement<HTMLDialogElement>('dialog');
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Assert a typed test fixture element or fail before using it.
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function submit(value: string): void {
  const input = requireElement<HTMLInputElement>('input[aria-label="Hex color"]');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  requireElement<HTMLFormElement>('dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  // Jsdom verifies save/lifecycle semantics; actual top-layer dialogs are tested in Obsidian.
  Object.defineProperties(HTMLDialogElement.prototype, {
    close: {
      configurable: true,
      value(this: HTMLDialogElement): void {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      }
    },
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement): void {
        this.open = true;
      }
    }
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('adapted Style Settings color dialogs', () => {
  it('waits for persistence and CSS before closing, preserving independent light/dark keys and alpha', async () => {
    const { colors, saved, setSettings } = createFixture();
    saved.set('nested-properties-advanced@@np-guide-color@@dark', '#112233');
    let complete: (() => void) | undefined;
    setSettings.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
    );
    const dialog = openDialog();
    submit('#AbC8');
    await vi.waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({ 'nested-properties-advanced@@np-guide-color@@light': '#aabbcc88' });
    });
    expect(dialog.isConnected).toBe(true);
    expect(requireElement<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(saved.get('nested-properties-advanced@@np-guide-color@@dark')).toBe('#112233');
    complete?.();
    await vi.waitFor(() => {
      expect(dialog.isConnected).toBe(false);
    });
    const dark = openDialog('dark');
    expect(requireElement<HTMLInputElement>('input[aria-label="Hex color"]').value).toBe('#112233');
    dark.close();
    colors.stop();
  });

  it('keeps invalid input and failed saves open for correction and retry', async () => {
    const { colors, setSettings } = createFixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dialog = openDialog();
    submit('#not-a-color');
    expect(setSettings).not.toHaveBeenCalled();
    expect(requireElement<HTMLInputElement>('input[aria-label="Hex color"]').getAttribute('aria-invalid')).toBe('true');
    setSettings.mockRejectedValueOnce(new Error('disk failure'));
    submit('#123456');
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledOnce();
    });
    expect(dialog.isConnected).toBe(true);
    expect(requireElement<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    submit('#234567');
    await vi.waitFor(() => {
      expect(dialog.isConnected).toBe(false);
    });
    expect(setSettings).toHaveBeenCalledTimes(2);
    colors.stop();
  });

  it('repairs only malformed colors owned by this plugin and restores upstream controls on unload', async () => {
    const { colors, original, saved, setSettings } = createFixture();
    saved.set('nested-properties-advanced@@np-thread-color-2@@dark', '#NaNNaNNaN');
    saved.set('other-plugin@@color@@dark', '#NaN');
    saved.set('nested-properties-advanced@@np-thread-color-3@@light', '#aabbcc');
    const dialog = openDialog();
    submit('#abcdef');
    await vi.waitFor(() => {
      expect(dialog.isConnected).toBe(false);
    });
    expect(setSettings).toHaveBeenCalledWith({
      'nested-properties-advanced@@np-guide-color@@light': '#abcdef',
      'nested-properties-advanced@@np-thread-color-2@@dark': THEMED_COLOR_DEFAULTS.get('np-thread-color-2')?.[1]
    });
    expect(saved.get('other-plugin@@color@@dark')).toBe('#NaN');
    expect(saved.get('nested-properties-advanced@@np-thread-color-3@@light')).toBe('#aabbcc');
    openDialog();
    colors.stop();
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelector('.np-style-color-controls')).toBeNull();
    expect(original.classList.contains('np-style-color-original')).toBe(false);
  });
});
