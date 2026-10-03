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
const FIXTURE = `---\n${JSON.stringify(MATH_KEY)}:\n  ${JSON.stringify(SVG_KEY)}:\n    "[[Testing Document]]": "**bold value** and $x^2$"\nrichValue: ${JSON.stringify(SVG_KEY)}\nplain: ordinary\n---\n\nBody\n`;

beforeAll(async () => {
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
});
