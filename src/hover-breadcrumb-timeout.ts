import type { PluginSettings } from './plugin-settings.ts';

export const DEFAULT_HOVER_BREADCRUMB_TIMEOUT_SECONDS = 0.02;
// Browsers schedule larger delays as an immediate timer after integer overflow.
export const MAX_HOVER_BREADCRUMB_TIMEOUT_SECONDS = 2_147_483.647;
const MILLISECONDS_PER_SECOND = 1000;

export function getHoverBreadcrumbTimeoutMilliseconds(settings: PluginSettings, mode: 'live-preview' | 'reading' | 'source'): number {
  const individual = mode === 'live-preview'
    ? settings.isControlLivePreviewModeHoverBreadcrumbTimeoutIndividuallyEnabled && settings.livePreviewModeHoverBreadcrumbTimeoutSeconds
    : (mode === 'source'
      ? settings.isControlSourceModeHoverBreadcrumbTimeoutIndividuallyEnabled && settings.sourceModeHoverBreadcrumbTimeoutSeconds
      : settings.isControlReadingModeHoverBreadcrumbTimeoutIndividuallyEnabled && settings.readingModeHoverBreadcrumbTimeoutSeconds);
  const seconds = individual === false
    ? (settings.isGloballyControlHoverBreadcrumbTimeoutEnabled
      ? settings.globalHoverBreadcrumbPopoverTimeoutSeconds
      : DEFAULT_HOVER_BREADCRUMB_TIMEOUT_SECONDS)
    : individual;
  return (isValidHoverBreadcrumbTimeout(seconds) ? seconds : DEFAULT_HOVER_BREADCRUMB_TIMEOUT_SECONDS) * MILLISECONDS_PER_SECOND;
}

export function isValidHoverBreadcrumbTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_HOVER_BREADCRUMB_TIMEOUT_SECONDS;
}
