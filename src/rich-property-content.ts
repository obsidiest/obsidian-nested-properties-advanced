import type { App } from 'obsidian';

import {
  Component,
  finishRenderMath,
  MarkdownRenderer
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';

import type { PluginSettings } from './plugin-settings.ts';

import { getHtmlElement } from './dom-target.ts';

export type PropertyRenderingMode = 'live-preview' | 'reading' | 'source';

/**
 * Adapted from List Tree Indentation Guides 2.0.2's render scope. A dismissed
 * surface must also release resources registered by a late Markdown render.
 */
export class PropertyRenderScopeComponent extends Component {
  public isDisposed = false;

  public constructor(private readonly owner: Component) {
    super();
    owner.addChild(this);
  }

  public override addChild<T extends Component>(child: T): T {
    if (!this.isDisposed) {
      return super.addChild(child);
    }
    child.unload();
    return child;
  }

  public dispose(): void {
    this.unload();
    this.owner.removeChild(this);
  }

  public override onunload(): void {
    this.isDisposed = true;
  }

  public override register(callback: () => unknown): void {
    if (this.isDisposed) {
      callback();
    } else {
      super.register(callback);
    }
  }
}

export function didHandleRichPropertyLink(app: App, event: MouseEvent, sourcePath: string): boolean {
  const anchor = getHtmlElement(event.target)?.closest<HTMLAnchorElement>('a.internal-link');
  const target = anchor?.dataset['href'] ?? anchor?.getAttribute('href');
  if (!target) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  invokeAsyncSafely(() =>
    app.workspace.openLinkText(target, sourcePath, event.ctrlKey || event.metaKey).catch((error: unknown) => {
      console.error('Nested Properties Advanced: property link navigation failed', error);
    })
  );
  return true;
}

export function hasRichPropertySyntax(source: string): boolean {
  return /[$*_`!~<[]/u.test(source);
}

export function isRichPropertyRenderingEnabled(settings: PluginSettings, mode: PropertyRenderingMode): boolean {
  return settings.isRichPropertyRenderingEnabled && (mode === 'live-preview'
    ? settings.isRichPropertyRenderingInLivePreviewEnabled
    : (mode === 'source' ? settings.isRichPropertyRenderingInSourceModeEnabled : settings.isRichPropertyRenderingInReadingModeEnabled));
}

export async function renderRichPropertyContent(app: App, source: string, label: HTMLElement, sourcePath: string, scope: PropertyRenderScopeComponent): Promise<void> {
  label.replaceChildren();
  label.classList.add('np-rich-content');
  try {
    // The host owns Markdown parsing, MathJax, SVG/HTML sanitization and embeds.
    await MarkdownRenderer.render(app, source, label, sourcePath, scope);
    await finishRenderMath();
  } catch (error) {
    if (!scope.isDisposed) {
      // eslint-disable-next-line require-atomic-updates -- Each target belongs to one render scope; disposed scopes cannot replace a newer label.
      label.textContent = source;
      console.error('Nested Properties Advanced: property rendering failed', error);
    }
  }
}
