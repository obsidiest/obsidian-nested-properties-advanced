import type { MetadataEditorProperty } from '@obsidian-typings/obsidian-public-latest';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { didHandleRootPropertyKeyEscape } from './root-property-key-editing.ts';

interface RootKeyControl {
  readonly input: HTMLInputElement;
  readonly property: MetadataEditorProperty;
  readonly save: ReturnType<typeof vi.fn>;
}

function createControl(value: unknown): RootKeyControl {
  const row = document.body.createDiv({ attr: { tabindex: '0' }, cls: 'metadata-property' });
  const input = row.createEl('input', { cls: 'metadata-property-key-input', value: 'original' });
  const initialEntry = { key: 'original', type: 'text', value };
  const save = vi.fn();
  const property = castTo<MetadataEditorProperty>({
    containerEl: row,
    entry: initialEntry,
    focusProperty: (): void => { row.focus(); },
    keyInputEl: input,
    metadataEditor: { removeProperties: vi.fn() }
  });
  input.addEventListener('blur', () => {
    if (input.value === property.entry.key) {
      return;
    }
    property.entry.key = input.value;
    save();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.defaultPrevented) {
      return;
    }
    // Model the inspected native control: Enter uses the current entry, while
    // Escape retains the constructor's entry even after metadata refresh.
    if (event.key === 'Enter') {
      property.entry.key = input.value;
      save();
    } else if (event.key === 'Escape') {
      input.value = initialEntry.key;
      property.focusProperty();
    }
  });
  input.addEventListener('keydown', (event) => {
    didHandleRootPropertyKeyEscape(event, property);
  }, { capture: true });
  // Native metadata synchronization reuses the input with a new entry object.
  property.entry = { ...initialEntry };
  input.focus();
  return { input, property, save };
}

function send(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('root key Escape uses the current metadata entry', () => {
  it.each([null, 'leaf value', { child: { leaf: 'value' } }])('should retain the Enter-committed name and value after refresh for %j', (value) => {
    const { input, property, save } = createControl(value);
    input.value = 'renamed';
    send(input, 'Enter');
    send(input, 'Escape');
    expect(property.entry).toMatchObject({ key: 'renamed', value });
    expect(input.value).toBe('renamed');
    expect(document.activeElement).toBe(property.containerEl);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('should cancel a subsequent uncommitted draft back to the latest committed name', () => {
    const { input, property, save } = createControl(null);
    input.value = 'renamed';
    send(input, 'Enter');
    property.entry = { ...property.entry };
    input.value = 'unfinished draft';
    send(input, 'Escape');
    expect(property.entry.key).toBe('renamed');
    expect(input.value).toBe('renamed');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('should cancel an edit without Enter without saving it', () => {
    const { input, property, save } = createControl(null);
    input.value = 'unfinished draft';
    send(input, 'Escape');
    expect(property.entry.key).toBe('original');
    expect(input.value).toBe('original');
    expect(save).not.toHaveBeenCalled();
  });

  it('should retain native cancellation of a newly added unnamed property', () => {
    const { input, property } = createControl(null);
    property.entry = { key: '', type: 'text', value: null };
    input.value = 'unfinished new property';
    send(input, 'Escape');
    expect(property.metadataEditor.removeProperties).toHaveBeenCalledExactlyOnceWith([property]);
  });

  it.each([
    { isComposing: true, key: 'Escape' },
    { key: 'Enter' },
    { key: 'Tab' }
  ])('should leave other native key handling intact for %j', (options) => {
    const { input, property } = createControl(null);
    const event = new KeyboardEvent('keydown', { cancelable: true, ...options });
    input.addEventListener('keydown', (received) => {
      expect(didHandleRootPropertyKeyEscape(received, property)).toBe(false);
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('should respect Escape already handled by another control', () => {
    const { input, property } = createControl(null);
    input.value = 'draft';
    const event = new KeyboardEvent('keydown', { cancelable: true, key: 'Escape' });
    event.preventDefault();
    input.dispatchEvent(event);
    expect(input.value).toBe('draft');
    expect(property.entry.key).toBe('original');
    expect(document.activeElement).toBe(input);
  });
});
