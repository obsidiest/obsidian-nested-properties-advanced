import {
  Component,
  MarkdownRenderer
} from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginSettings } from './plugin-settings.ts';
import {
  hasRichPropertySyntax,
  isRichPropertyRenderingEnabled,
  PropertyRenderScopeComponent,
  renderRichPropertyContent
} from './rich-property-content.ts';

describe('rich property content', () => {
  it('enables all three modes by default and applies independent subordinate controls', () => {
    const settings = new PluginSettings();
    const modes = ['live-preview', 'source', 'reading'] as const;
    expect(modes.map((mode) => isRichPropertyRenderingEnabled(settings, mode))).toEqual([true, true, true]);
    settings.isRichPropertyRenderingInSourceModeEnabled = false;
    expect(modes.map((mode) => isRichPropertyRenderingEnabled(settings, mode))).toEqual([true, false, true]);
    settings.isRichPropertyRenderingInReadingModeEnabled = false;
    expect(modes.map((mode) => isRichPropertyRenderingEnabled(settings, mode))).toEqual([true, false, false]);
    settings.isRichPropertyRenderingEnabled = false;
    expect(modes.map((mode) => isRichPropertyRenderingEnabled(settings, mode))).toEqual([false, false, false]);
  });

  it('delegates intact markup and its originating note path to the host renderer', async () => {
    const owner = new Component();
    owner.load();
    const scope = new PropertyRenderScopeComponent(owner);
    const app = App.createConfigured__().asOriginalType__();
    const label = createSpan();
    const source = String.raw`test $\approx$ **bold** [[Testing Document]] <svg><path d="M0 0h10"/></svg>`;
    const renderer = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue(undefined);
    await renderRichPropertyContent(app, source, label, 'folder/note.md', scope);
    expect(renderer).toHaveBeenCalledWith(app, source, label, 'folder/note.md', scope);
    expect(hasRichPropertySyntax(source)).toBe(true);
    expect(hasRichPropertySyntax('Ordinary property')).toBe(false);
    scope.dispose();
    owner.unload();
  });

  it('cleans both existing and late Markdown resources after a surface is dismissed', () => {
    const owner = new Component();
    owner.load();
    const scope = new PropertyRenderScopeComponent(owner);
    const early = vi.fn();
    const late = vi.fn();
    scope.register(early);
    scope.dispose();
    scope.register(late);
    const child = new Component();
    const unload = vi.spyOn(child, 'unload');
    scope.addChild(child);
    expect(scope.isDisposed).toBe(true);
    expect(early).toHaveBeenCalledOnce();
    expect(late).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledOnce();
    owner.unload();
    expect(early).toHaveBeenCalledOnce();
  });
});
