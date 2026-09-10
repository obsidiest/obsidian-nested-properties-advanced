import {
  describe,
  expect,
  it
} from 'vitest';

import { getHoverBreadcrumbTimeoutMilliseconds } from './hover-breadcrumb-timeout.ts';
import { PluginSettings } from './plugin-settings.ts';

describe('hover breadcrumb timeout precedence', () => {
  it.each(['live-preview', 'source', 'reading'] as const)('should use the global value or default in %s', (mode) => {
    const settings = new PluginSettings();
    expect(getHoverBreadcrumbTimeoutMilliseconds(settings, mode)).toBe(1000);
    settings.globalHoverBreadcrumbPopoverTimeoutSeconds = 1.275;
    expect(getHoverBreadcrumbTimeoutMilliseconds(settings, mode)).toBe(1275);
    settings.isGloballyControlHoverBreadcrumbTimeoutEnabled = false;
    expect(getHoverBreadcrumbTimeoutMilliseconds(settings, mode)).toBe(1000);
  });

  it.each([true, false])('should apply independent mode overrides when global control is %s', (global) => {
    const settings = new PluginSettings();
    settings.isGloballyControlHoverBreadcrumbTimeoutEnabled = global;
    settings.globalHoverBreadcrumbPopoverTimeoutSeconds = 8;
    settings.isControlLivePreviewModeHoverBreadcrumbTimeoutIndividuallyEnabled = true;
    settings.isControlSourceModeHoverBreadcrumbTimeoutIndividuallyEnabled = true;
    settings.isControlReadingModeHoverBreadcrumbTimeoutIndividuallyEnabled = true;
    settings.livePreviewModeHoverBreadcrumbTimeoutSeconds = 0;
    settings.sourceModeHoverBreadcrumbTimeoutSeconds = 2.25;
    settings.readingModeHoverBreadcrumbTimeoutSeconds = 0.35;
    expect(getHoverBreadcrumbTimeoutMilliseconds(settings, 'live-preview')).toBe(0);
    expect(getHoverBreadcrumbTimeoutMilliseconds(settings, 'source')).toBe(2250);
    expect(getHoverBreadcrumbTimeoutMilliseconds(settings, 'reading')).toBe(350);
  });

  it('should reject invalid persisted values before scheduling a browser timer', () => {
    const settings = new PluginSettings();
    for (const value of [NaN, Infinity, -1, 3_000_000]) {
      settings.globalHoverBreadcrumbPopoverTimeoutSeconds = value;
      expect(getHoverBreadcrumbTimeoutMilliseconds(settings, 'source')).toBe(1000);
    }
  });
});
