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
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { writeDesktopFixtures } from '../scripts/desktop-fixtures.ts';

interface RenderContext {
  markdownView: MarkdownView;
  tab: PluginSettingTab;
}

const vault = getTemporaryVault();
const contextId = new ContextId<RenderContext>();
const MATH_KEY = String.raw`test $\approx$ test`;
const SVG_KEY = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg>';
const FIXTURE = `---\n${JSON.stringify(MATH_KEY)}:\n  ${JSON.stringify(SVG_KEY)}:\n    "[[Testing Document]]": "**bold value** and $x^2$"\nrichValue: ${JSON.stringify(SVG_KEY)}\n"Release Types": ordinary\n---\n\nBody\n`;
const TALL_SVG_KEY = SVG_KEY.replace('height="16"', 'height="2.5em"');
const TYPOGRAPHY_FIXTURE = FIXTURE.replace(JSON.stringify(SVG_KEY), () => JSON.stringify(TALL_SVG_KEY));
let minimalCss = '';

beforeAll(async () => {
  minimalCss = await evalInObsidian({
    callback: async ({ app, obsidianModule: { requestUrl } }) => {
      const response = await requestUrl('https://raw.githubusercontent.com/kepano/obsidian-minimal/504c2e9c27012f4ea7cc898d242722ee8b795dbc/theme.css');
      const directory = `${app.vault.configDir}/themes/Minimal-rich-rendering`;
      for (const folder of [`${app.vault.configDir}/themes`, directory]) {
        if (!await app.vault.adapter.exists(folder)) {
          await app.vault.adapter.mkdir(folder);
        }
      }
      await app.vault.adapter.write(`${directory}/manifest.json`, JSON.stringify({ author: '@kepano', minAppVersion: '1.9.0', name: 'Minimal-rich-rendering', version: '8.2.2' }));
      await app.vault.adapter.write(`${directory}/theme.css`, response.text);
      return response.text;
    },
    vaultPath: vault.path
  });
  await writeDesktopFixtures(vault.path, { 'rich-properties.md': FIXTURE, 'Testing Document.md': '# Linked note' });
});

beforeEach(async () => {
  await evalInObsidian({
    callback: async ({ app, context, fixture, lib: { hoverElement, waitUntil } }) => {
      const file = app.vault.getFileByPath('rich-properties.md');
      if (file === null) {
        throw new Error('Rich property fixture missing');
      }
      await app.vault.modify(file, fixture);
      const leaf = app.workspace.getLeaf(true);
      await leaf.setViewState({ state: { file: file.path, mode: 'source', source: false }, type: 'markdown' });
      context.markdownView = leaf.view as MarkdownView;
      const tab = app.setting.pluginTabs.find((candidate) => candidate.id === 'nested-properties-advanced');
      if (tab === undefined) {
        throw new Error('Settings tab missing');
      }
      context.tab = tab;
      for (const key of ['isRichPropertyRenderingEnabled', 'isRichPropertyRenderingInLivePreviewEnabled', 'isRichPropertyRenderingInSourceModeEnabled', 'isRichPropertyRenderingInReadingModeEnabled', 'isPropertyFieldHoverBreadcrumbEnabled', 'isPropertyFieldHoverBreadcrumbInLivePreviewEnabled', 'isPropertyFieldHoverBreadcrumbInSourceModeEnabled', 'isPropertyFieldHoverBreadcrumbInReadingModeEnabled', 'isFullWidthPropertyFieldHoverActivationEnabled']) {
        await tab.setControlValue(key, true);
      }
      await tab.setControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds', 1);
      await hoverElement({ element: leaf.tabHeaderEl });
      await waitUntil({ predicate: () => leaf.view.containerEl.querySelector('.metadata-property-key-input') !== null });
      context.markdownView.editor.setCursor({ ch: 0, line: 9 });
    },
    contextId,
    input: { fixture: FIXTURE },
    vaultPath: vault.path
  });
});

afterEach(async () => {
  await evalInObsidian({
    callback: ({ context }) => {
      (context as Partial<RenderContext>).markdownView?.leaf.detach();
    },
    contextId,
    vaultPath: vault.path
  });
});
afterAll(async () => {
  await contextId.dispose();
});

describe('rich properties through Obsidian MarkdownRenderer', () => {
  it.each(['live-preview', 'reading'].flatMap((mode) => [false, true].map((popout) => ({ mode, popout }))))('renders a restored view after plugin reload in $mode with popout=$popout', async ({ mode, popout }) => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { markdownView }, css, keys, lib: { waitUntil }, modeName, usePopout }) => {
        const previousTheme = app.customCss.theme;
        const root = markdownView.containerEl;
        try {
          app.customCss.setTheme('Minimal-rich-rendering');
          await waitUntil({ predicate: () => app.customCss.styleEl.textContent.includes(css.slice(0, 100)) });
          await markdownView.leaf.setViewState({ state: { file: 'rich-properties.md', mode: modeName === 'reading' ? 'preview' : 'source', source: false }, type: 'markdown' });
          if (usePopout) {
            const opened = app.workspace.moveLeafToPopout(markdownView.leaf, { size: { height: 1000, width: 1100 } });
            opened.win.electronWindow.focus();
            await waitUntil({ predicate: () => root.ownerDocument === opened.doc && opened.doc.hasFocus() });
          }
          await waitUntil({ predicate: () => root.querySelector(':scope .np-rich-property-label mjx-container') !== null });
          // A restored tab may still be hidden while the plugin attaches. Reveal it
          // After startup work settles, without a settings change or file-open event.
          root.hide();
          await app.plugins.disablePlugin('nested-properties-advanced');
          await app.plugins.enablePlugin('nested-properties-advanced');
          for (let frame = 0; frame < 3; frame++) {
            await new Promise<void>((resolve) => {
              root.win.requestAnimationFrame(() => {
                resolve();
              });
            });
          }
          const hiddenWidth = root.getBoundingClientRect().width;
          root.show();
          await waitUntil({ predicate: () => root.getBoundingClientRect().width > 0 });
          const key = [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((input) => input.value === keys[2]);
          if (key?.parentElement === null || key === undefined) {
            throw new Error('Restored property key missing');
          }
          const keyRect = key.parentElement.getBoundingClientRect();
          root.win.electronWindow.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((keyRect.left + keyRect.right) / 2), y: Math.round((keyRect.top + keyRect.bottom) / 2) });
          const doc = root.ownerDocument;
          await waitUntil({ predicate: () => doc.querySelector(':scope .np-property-breadcrumb-label mjx-container') !== null && doc.querySelector(':scope .np-property-breadcrumb-label svg path') !== null && doc.querySelector(':scope .np-property-breadcrumb-label a.internal-link') !== null });
          try {
            await waitUntil({ predicate: () => root.querySelector(':scope .np-rich-property-label mjx-container') !== null && root.querySelector(':scope .np-rich-property-label svg path') !== null && root.querySelector(':scope .np-rich-property-label a.internal-link') !== null });
          } catch (error) {
            throw new Error(`Main UI rendering did not return after revealing the view: ${JSON.stringify({ breadcrumbLabels: doc.querySelectorAll('.np-property-breadcrumb-label').length, hiddenWidth, labels: root.querySelectorAll('.np-rich-property-label').length, mode: markdownView.getMode(), sourceClass: root.querySelector('.markdown-source-view')?.className, width: root.getBoundingClientRect().width })}`, { cause: error });
          }
          const reference = [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((input) => input.value === 'Release Types');
          if (reference === undefined) {
            throw new Error('Native typography reference missing');
          }
          return {
            fields: keys.map((name) => {
              const input = [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((element) => element.value === name);
              const label = input?.parentElement?.querySelector<HTMLElement>('.np-rich-property-label');
              const icon = input?.parentElement?.querySelector('.metadata-property-icon');
              const content = label?.firstElementChild;
              if (!input || !label || !icon || !content) {
                throw new Error(`Missing rendered field after view restore: ${name}`);
              }
              const iconRect = icon.getBoundingClientRect();
              const contentRect = content.getBoundingClientRect();
              return {
                centerDelta: (iconRect.top + iconRect.bottom - contentRect.top - contentRect.bottom) / 2,
                fontSize: label.win.getComputedStyle(label).fontSize,
                nativeFontSize: reference.win.getComputedStyle(reference).fontSize,
                rawOpacity: input.win.getComputedStyle(input).opacity,
                visible: !label.hidden && label.getBoundingClientRect().height > 0
              };
            }),
            hiddenWidth
          };
        } finally {
          root.show();
          app.customCss.setTheme(previousTheme);
        }
      },
      contextId,
      input: { css: minimalCss, keys: [MATH_KEY, SVG_KEY, '[[Testing Document]]'], modeName: mode, usePopout: popout },
      vaultPath: vault.path
    });
    expect(result.hiddenWidth).toBe(0);
    for (const field of result.fields) {
      expect(field.visible).toBe(true);
      expect(field.rawOpacity).toBe('0');
      expect(field.fontSize).toBe(field.nativeFontSize);
      expect(Math.abs(field.centerDelta)).toBeLessThanOrEqual(0.5);
    }
  });

  it.each(['live-preview', 'source', 'reading'])('renders the screenshot key/value syntax and breadcrumb hierarchy in %s', async (mode) => {
    const result = await evalInObsidian({
      callback: async ({ app, context: { markdownView, tab }, fixture, lib: { hoverElement, waitUntil }, modeName }) => {
        await markdownView.leaf.setViewState({ state: { file: 'rich-properties.md', mode: modeName === 'reading' ? 'preview' : 'source', source: modeName === 'source' }, type: 'markdown' });
        if (modeName === 'source') {
          markdownView.editor.setCursor({
            ch: 0,
            line: 9
          });
        }
        const root = markdownView.containerEl;
        const labelSelector = modeName === 'source' ? '.np-rich-source-property' : '.np-rich-property-label';
        await waitUntil({
          message: `Host math/SVG/Markdown did not render in ${modeName}`,
          predicate: () => root.querySelector(`:scope ${labelSelector} mjx-container`) !== null && root.querySelector(`:scope ${labelSelector} svg path`) !== null && root.querySelector(`:scope ${labelSelector} a.internal-link`) !== null && root.querySelector(`:scope ${labelSelector} strong`) !== null
        });
        const valueSvg = modeName === 'source' ? root.querySelectorAll(`${labelSelector} svg path`).length : root.querySelectorAll(`.metadata-property-value ${labelSelector} svg path`).length;
        // Default breadcrumbs show ancestors. Hover the deepest key so the
        // Math and SVG parents are both part of the expected hierarchy.
        const anchor = root.querySelector(`${labelSelector} a.internal-link`)?.closest<HTMLElement>(labelSelector);
        if (anchor === null || anchor === undefined) {
          throw new Error('Breadcrumb hover anchor missing');
        }
        await hoverElement({ element: anchor });
        const doc = root.ownerDocument;
        await waitUntil({
          message: 'Breadcrumb did not render math, SVG and wikilink hierarchy',
          predicate: () => doc.querySelector(':scope .np-property-breadcrumb-label mjx-container') !== null && doc.querySelector(':scope .np-property-breadcrumb-label svg path') !== null && doc.querySelector(':scope .np-property-breadcrumb-label a.internal-link') !== null
        });
        const modeKey = modeName === 'source' ? 'isRichPropertyRenderingInSourceModeEnabled' : (modeName === 'reading' ? 'isRichPropertyRenderingInReadingModeEnabled' : 'isRichPropertyRenderingInLivePreviewEnabled');
        await hoverElement({ element: markdownView.leaf.tabHeaderEl });
        await tab.setControlValue(modeKey, false);
        await waitUntil({ message: 'Mode toggle did not restore plain property display', predicate: () => root.querySelector(labelSelector) === null });
        const file = app.vault.getFileByPath('rich-properties.md');
        return { unchanged: file !== null && await app.vault.read(file) === fixture, valueSvg };
      },
      contextId,
      input: { fixture: FIXTURE, modeName: mode },
      vaultPath: vault.path
    });
    expect(result.valueSvg).toBeGreaterThan(0);
    expect(result.unchanged).toBe(true);
  });

  it('keeps rendered Source key-only activation outside the rendered value', async () => {
    const isResult = await evalInObsidian({
      callback: async ({ context: { markdownView, tab }, lib: { hoverElement, waitUntil } }) => {
        await markdownView.leaf.setViewState({ state: { file: 'rich-properties.md', mode: 'source', source: true }, type: 'markdown' });
        markdownView.editor.setCursor({ ch: 0, line: 9 });
        await tab.setControlValue('isFullWidthPropertyFieldHoverActivationEnabled', false);
        await tab.setControlValue('isFullWidthPropertyKeyHoverActivationEnabled', true);
        await tab.setControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds', 0.01);
        const root = markdownView.containerEl;
        const doc = root.ownerDocument;
        await waitUntil({ predicate: () => root.querySelector(':scope .np-rich-source-property strong') !== null });
        const key = root.querySelector(':scope .np-rich-source-property a.internal-link')?.closest<HTMLElement>('.np-rich-source-property');
        const value = root.querySelector(':scope .np-rich-source-property strong')?.closest<HTMLElement>('.np-rich-source-property');
        if (!key || !value) {
          throw new Error('Rendered Source key/value missing');
        }
        await hoverElement({ element: key });
        await waitUntil({ message: 'Rendered Source key did not activate breadcrumb', predicate: () => doc.querySelector('.np-property-breadcrumb-popover') !== null });
        await hoverElement({ element: value });
        await waitUntil({ message: 'Rendered Source value wrongly retained key-only breadcrumb', predicate: () => doc.querySelector('.np-property-breadcrumb-popover') === null });
        return true;
      },
      contextId,
      vaultPath: vault.path
    });
    expect(isResult).toBe(true);
  });

  it.each(['live-preview', 'source'])('keeps a single rendered breadcrumb click at the original key end in %s', async (mode) => {
    const result = await evalInObsidian({
      callback: async ({ context: { markdownView, tab }, lib: { clickElement, hoverElement, waitUntil }, mathKey, modeName }) => {
        await markdownView.leaf.setViewState({ state: { file: 'rich-properties.md', mode: 'source', source: modeName === 'source' }, type: 'markdown' });
        markdownView.editor.setCursor({ ch: 0, line: 9 });
        const root = markdownView.containerEl;
        const doc = root.ownerDocument;
        await waitUntil({ predicate: () => root.querySelector(modeName === 'source' ? '.np-rich-source-property mjx-container' : '.np-rich-property-label mjx-container') !== null });
        const anchor = root.querySelector<HTMLElement>(modeName === 'source' ? '.np-rich-source-property' : '.metadata-property-icon');
        if (anchor === null) {
          throw new Error('Rich hover target missing');
        }
        await hoverElement({ element: anchor });
        await waitUntil({ predicate: () => doc.querySelector(':scope .np-property-breadcrumb-key mjx-container') !== null });
        const button = doc.querySelector<HTMLButtonElement>('.np-property-breadcrumb-key');
        if (button === null) {
          throw new Error('Rendered breadcrumb missing');
        }
        clickElement({ element: button });
        await tab.setControlValue('globalHoverBreadcrumbPopoverTimeoutSeconds', 0.01);
        await hoverElement({ element: markdownView.leaf.tabHeaderEl });
        await waitUntil({ predicate: () => doc.querySelector(':scope .np-property-breadcrumb-popover') === null });
        if (modeName === 'source') {
          const cursor = markdownView.editor.getCursor();
          return { focused: markdownView.editor.hasFocus(), key: markdownView.editor.getLine(cursor.line).slice(0, cursor.ch) };
        }
        const input = [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((element) => element.value === mathKey);
        return { focused: input === doc.activeElement, key: input?.value.slice(0, input.selectionStart ?? 0) };
      },
      contextId,
      input: { mathKey: MATH_KEY, modeName: mode },
      vaultPath: vault.path
    });
    expect(result.focused).toBe(true);
    expect(result.key).toBe(mode === 'source' ? JSON.stringify(MATH_KEY).slice(0, -1) : MATH_KEY);
  });

  it.each(['default', 'minimal'].flatMap((theme) => ['live-preview', 'reading'].map((mode) => ({ mode, theme }))))('matches native icon spacing for math, SVG and Markdown keys in $mode with $theme', async ({ mode, theme }) => {
    const results = await evalInObsidian({
      callback: async ({ app, context: { markdownView, tab }, css, keys, lib: { waitUntil }, modeName, themeName }) => {
        const previousTheme = app.customCss.theme;
        const root = markdownView.containerEl;
        const previousPadding = root.style.getPropertyValue('--metadata-input-padding');
        try {
          app.customCss.setTheme(themeName === 'minimal' ? 'Minimal-rich-rendering' : '');
          await waitUntil({ predicate: () => themeName === 'minimal' ? app.customCss.styleEl.textContent.includes(css.slice(0, 100)) : app.customCss.styleEl.textContent.trim() === '' });
          await markdownView.leaf.setViewState({ state: { file: 'rich-properties.md', mode: modeName === 'reading' ? 'preview' : 'source', source: false }, type: 'markdown' });
          await waitUntil({ predicate: () => [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].filter((input) => keys.includes(input.value)).length === keys.length });
          function measureGaps(isRendered: boolean): number[] {
            return [...keys, 'Release Types'].map((name) => {
              const input = [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((element) => element.value === name);
              const key = input?.closest('.metadata-property-key');
              const icon = key?.querySelector('.metadata-property-icon');
              const target = isRendered && name !== 'Release Types' ? key?.querySelector<HTMLElement>('.np-rich-property-label') : input;
              if (!icon || !target) {
                throw new Error(`Missing property key for spacing measurement: ${name}`);
              }
              const style = target.win.getComputedStyle(target);
              return target.getBoundingClientRect().left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft) - icon.getBoundingClientRect().right;
            });
          }
          const measurements = [];
          // Compare real key controls and rendered labels, including a theme/snippet
          // Override of Obsidian's own padding variable instead of assuming pixels.
          for (const padding of ['', '6px 17px']) {
            root.style.setProperty('--metadata-input-padding', padding);
            await tab.setControlValue('isRichPropertyRenderingEnabled', false);
            await waitUntil({ predicate: () => root.querySelector('.np-rich-property-label') === null && [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].filter((input) => keys.includes(input.value)).length === keys.length });
            const native = measureGaps(false);
            await tab.setControlValue('isRichPropertyRenderingEnabled', true);
            await waitUntil({ predicate: () => root.querySelector(':scope .np-rich-property-label mjx-container') !== null && root.querySelector(':scope .np-rich-property-label svg path') !== null && root.querySelector(':scope .np-rich-property-label a.internal-link') !== null });
            measurements.push({ native, rendered: measureGaps(true) });
          }
          return measurements;
        } finally {
          root.style.setProperty('--metadata-input-padding', previousPadding);
          app.customCss.setTheme(previousTheme);
        }
      },
      contextId,
      input: { css: minimalCss, keys: [MATH_KEY, SVG_KEY, '[[Testing Document]]'], modeName: mode, themeName: theme },
      vaultPath: vault.path
    });
    for (const result of results) {
      const reference = result.native.at(-1);
      expect(reference).toBeGreaterThan(0);
      expect(result.native).toEqual([reference, reference, reference, reference]);
      expect(result.rendered).toEqual(result.native);
    }
  });

  it.each(['default', 'minimal'].flatMap((theme) => ['live-preview', 'reading'].map((mode) => ({ mode, theme }))))('matches native typography and centers icons beside rendered keys in $mode with $theme', async ({ mode, theme }) => {
    const measurements = await evalInObsidian({
      callback: async ({ app, context: { markdownView, tab }, css, fixture, keys, lib: { waitUntil }, modeName, themeName }) => {
        const previousTheme = app.customCss.theme;
        const root = markdownView.containerEl;
        const originalStyle = root.style.cssText;
        const previousFullKeySettings = ['isGlobalToggleFullKeyNamesEnabled', 'isGlobalExpandFullKeyNamesEnabled', 'isGlobalCollapseFullKeyNamesEnabled'].map((key) => ({ key, value: tab.getControlValue(key) }));
        try {
          app.customCss.setTheme(themeName === 'minimal' ? 'Minimal-rich-rendering' : '');
          await waitUntil({ predicate: () => themeName === 'minimal' ? app.customCss.styleEl.textContent.includes(css.slice(0, 100)) : app.customCss.styleEl.textContent.trim() === '' });
          const file = app.vault.getFileByPath('rich-properties.md');
          if (file === null) {
            throw new Error('Typography fixture missing');
          }
          await app.vault.modify(file, fixture);
          await markdownView.leaf.setViewState({ state: { file: file.path, mode: modeName === 'reading' ? 'preview' : 'source', source: false }, type: 'markdown' });
          await waitUntil({ predicate: () => keys.every((name) => [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].some((input) => input.value === name && input.parentElement?.querySelector('.np-rich-property-label') !== null)) && root.querySelector(':scope .np-rich-property-label mjx-container') !== null && root.querySelector(':scope .np-rich-property-label svg[height="2.5em"]') !== null && root.querySelector(':scope .np-rich-property-label a.internal-link') !== null });
          await tab.setControlValue('isGlobalToggleFullKeyNamesEnabled', true);
          const results = [];
          // Separate note text sizing from metadata sizing and also force wrapped keys.
          for (const fontSize of ['13px', '18px']) {
            root.setCssProps({ '--font-text-size': '26px', '--metadata-label-font-size': fontSize, '--metadata-label-font-weight': '500', '--metadata-label-width': '100px' });
            for (const isWrapped of [false, true]) {
              await tab.setControlValue(isWrapped ? 'isGlobalCollapseFullKeyNamesEnabled' : 'isGlobalExpandFullKeyNamesEnabled', true);
              await waitUntil({ predicate: () => root.querySelector('.metadata-container')?.classList.contains('nested-properties-full-key-display') === !isWrapped });
              const reference = [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((input) => input.value === 'Release Types');
              if (reference === undefined) {
                throw new Error('Native typography reference missing');
              }
              const referenceStyle = reference.win.getComputedStyle(reference);
              for (const name of keys) {
                const input = [...root.querySelectorAll<HTMLInputElement>('.metadata-property-key-input')].find((element) => element.value === name);
                const key = input?.closest<HTMLElement>('.metadata-property-key');
                const icon = key?.querySelector<HTMLElement>('.metadata-property-icon');
                const label = key?.querySelector<HTMLElement>('.np-rich-property-label');
                const content = label?.firstElementChild;
                if (!key || !icon || !label || !content) {
                  throw new Error('Rendered typography target missing');
                }
                const labelStyle = label.win.getComputedStyle(label);
                const iconRect = icon.getBoundingClientRect();
                const contentRect = content.getBoundingClientRect();
                const svgHeight = label.querySelector('svg[height="2.5em"]')?.getBoundingClientRect().height;
                results.push({
                  centerDelta: (iconRect.top + iconRect.bottom - contentRect.top - contentRect.bottom) / 2,
                  fontSize: labelStyle.fontSize,
                  fontWeight: labelStyle.fontWeight,
                  nativeFontSize: referenceStyle.fontSize,
                  nativeFontWeight: referenceStyle.fontWeight,
                  svgHeight,
                  wrapped: isWrapped
                });
              }
            }
          }
          return results;
        } finally {
          // eslint-disable-next-line require-atomic-updates -- Restore temporary styles owned by this isolated test view.
          root.style.cssText = originalStyle;
          for (const setting of previousFullKeySettings) {
            await tab.setControlValue(setting.key, setting.value);
          }
          app.customCss.setTheme(previousTheme);
        }
      },
      contextId,
      input: { css: minimalCss, fixture: TYPOGRAPHY_FIXTURE, keys: [MATH_KEY, TALL_SVG_KEY, '[[Testing Document]]'], modeName: mode, themeName: theme },
      vaultPath: vault.path
    });
    for (const measurement of measurements) {
      expect(measurement.fontSize, JSON.stringify(measurement)).toBe(measurement.nativeFontSize);
      expect(measurement.fontWeight, JSON.stringify(measurement)).toBe(measurement.nativeFontWeight);
      expect(Math.abs(measurement.centerDelta), JSON.stringify(measurement)).toBeLessThanOrEqual(0.5);
      if (measurement.svgHeight !== undefined) {
        expect(measurement.svgHeight).toBeCloseTo(Number.parseFloat(measurement.nativeFontSize) * 2.5, 1);
      }
    }
  });
});
