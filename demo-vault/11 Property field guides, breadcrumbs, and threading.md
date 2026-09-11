---
project:
  identity:
    name: Nested Properties Advanced
    version: 2.0.0
  release:
    channel: beta
    artifacts:
      - main.js
      - manifest.json
      - styles.css
contributors:
  - name: Ada
    role: design
  - name: Grace
    role: engineering
---

# Property field guides, breadcrumbs, and threading

This note's own properties form several nested branches. Use them to try the visual hierarchy features without changing another note.

1. Open **Settings → Nested Properties Advanced**. **Property Field Hover Breadcrumb** is enabled by default and can be switched off globally or by view mode.
2. By default, hover anywhere across a property key. Enable **Full-Width Property Field Hover Activation** to include the value and the rest of the row, or disable both activation-scope switches to require the property icon in Live Preview/Reading mode or the fold-gutter area beside any Source property, including leaves without an expansion toggle.
3. Try the selected activation scope above this note in Live Preview, then switch to Source and Reading modes. Long breadcrumb names wrap by default; disable **Full Property Field Name Expansion in a Property Field Hover Breadcrumb** to compare the compact presentation.
4. Tab into the breadcrumb to navigate with the arrow, Home, and End keys. Click a row once (or activate its button with Enter/Space) to place the caret at the key's end in Live Preview or the property line's end in Source. Move the pointer away, let the popover close, and type to check that the editor retains the caret.
5. Enable **Property Field Threading**. Compare active-field, all-branches, root-level, and cursor activation while moving between `project`, `contributors`, and their descendants.
6. Install and enable **Style Settings**, then open **Nested Properties Advanced** there to adjust guide lines, depth colors, breadcrumb sizing, typography, and spacing. Every numerical slider has a synchronized precise text box.

Static main-UI and breadcrumb guides and the hover breadcrumb are enabled by default. The threading master switch remains disabled by default, so threading is opt-in. **Highlight Active Property Field Tree** is also opt-in and has its own Style Settings controls.

Under **Hover Breadcrumb Popover Timeout**, all four numerical settings default to **0.02 seconds**. The individual options are named **Live Preview Mode Hover Breadcrumb Popover Timeout**, **Source Mode Hover Breadcrumb Popover Timeout**, and **Reading Mode Hover Breadcrumb Popover Timeout**. Existing saved values remain in effect.

## Hover Breadcrumb Popover Timeout

The fold-gutter area before every Source property activates a breadcrumb under all four combinations of the two activation-scope switches. Compare the parent `project` with the leaf `name`, including when both switches are disabled.

1. In the **Hover Breadcrumb Popover Timeout** settings section, leave **Globally Control Hover Breadcrumb Timeout** enabled and set **Global Hover Breadcrumb Popover Timeout** to `2.5` seconds. Open a breadcrumb, move through the gap into it, and click an ancestor to navigate. Moving entirely away should close it after the configured delay.
2. Enable **Control Source Mode Hover Breadcrumb Timeout Individually** and set **Source Mode** to `4` seconds. Source now uses four seconds while Live Preview and Reading retain the global value.
3. Enable **Control Live Preview Mode Hover Breadcrumb Timeout Individually** and **Control Reading Mode Hover Breadcrumb Timeout Individually**, and enter distinct values in **Live Preview Mode** and **Reading Mode**. Each enabled individual control overrides the global setting, even when global control remains enabled.
4. Disable global control and all three individual controls to try the built-in one-second delay. Re-enable global control to return to your saved global value. Zero means immediate dismissal; decimal seconds are supported. Reload the plugin to check that your values persist.

## Settings coverage

The plugin's searchable settings page exposes the switches and numeric controls below. Child controls are disabled until their parent switch is enabled.

- `allNestedPropertiesExpansionStateByNote`
- `fullKeyNamesExpansionStateByNote`
- `isRememberLastUsedMainUiToggleStatesEnabled`
- `isRememberAllNestedPropertiesExpansionToggleStateEnabled`
- `isRememberFullKeyNamesExpansionToggleStateEnabled`
- `isGlobalToggleAllNestedPropertiesEnabled`
- `isGlobalExpandAllNestedPropertiesEnabled`
- `isGlobalCollapseAllNestedPropertiesEnabled`
- `isPerNoteToggleAllNestedPropertiesEnabled`
- `isGlobalToggleFullKeyNamesEnabled`
- `isGlobalExpandFullKeyNamesEnabled`
- `isGlobalCollapseFullKeyNamesEnabled`
- `isPerNoteToggleFullKeyNamesEnabled`
- `isHighlightActivePropertyFieldTreeEnabled`
- `isPropertyFieldHoverBreadcrumbEnabled`
- `isFullPropertyFieldNameExpansionInHoverBreadcrumbEnabled`
- `isFullWidthPropertyFieldHoverActivationEnabled`
- `isFullWidthPropertyKeyHoverActivationEnabled`
- `isPropertyFieldHoverBreadcrumbInLivePreviewEnabled`
- `isPropertyFieldHoverBreadcrumbInSourceModeEnabled`
- `isPropertyFieldHoverBreadcrumbInReadingModeEnabled`
- `isPropertyFieldHoverBreadcrumbStaticTreeIndentationGuidesEnabled`
- `isGloballyControlHoverBreadcrumbTimeoutEnabled`
- `globalHoverBreadcrumbPopoverTimeoutSeconds`
- `isControlLivePreviewModeHoverBreadcrumbTimeoutIndividuallyEnabled`
- `livePreviewModeHoverBreadcrumbTimeoutSeconds`
- `isControlSourceModeHoverBreadcrumbTimeoutIndividuallyEnabled`
- `sourceModeHoverBreadcrumbTimeoutSeconds`
- `isControlReadingModeHoverBreadcrumbTimeoutIndividuallyEnabled`
- `readingModeHoverBreadcrumbTimeoutSeconds`
- `isNestedPropertiesMainUiStaticTreeIndentationGuidesEnabled`
- `isNestedPropertiesMainUiStaticTreeIndentationGuidesInLivePreviewEnabled`
- `isNestedPropertiesMainUiStaticTreeIndentationGuidesInSourceModeEnabled`
- `isNestedPropertiesMainUiStaticTreeIndentationGuidesInReadingModeEnabled`
- `isPropertyFieldThreadingEnabled`
- `isPropertyFieldThreadingInMainUiEnabled`
- `isPropertyFieldThreadingInHoverBreadcrumbEnabled`
- `isPropertyFieldThreadingInLivePreviewEnabled`
- `isPropertyFieldThreadingInSourceModeEnabled`
- `isPropertyFieldThreadingInReadingModeEnabled`
- `isActiveCursorPropertyFieldThreadingEnabled`
- `isActivePropertyFieldThreadingEnabled`
- `isActivePropertyFieldThreadingInMainUiEnabled`
- `isActivePropertyFieldThreadingInHoverBreadcrumbEnabled`
- `isAllBranchesOfActivePropertyFieldTreeThreadingEnabled`
- `isAllBranchesOfActivePropertyFieldTreeThreadingInMainUiEnabled`
- `isAllBranchesOfActivePropertyFieldTreeThreadingInHoverBreadcrumbEnabled`
- `isActiveRootLevelPropertyFieldTreeThreadingEnabled`
- `isActiveRootLevelPropertyFieldThreadingEnabled`
- `isActiveRootLevelPropertyFieldThreadingInMainUiEnabled`
- `isActiveRootLevelPropertyFieldThreadingInHoverBreadcrumbEnabled`
- `isAllBranchesOfActiveRootLevelPropertyFieldTreeThreadingEnabled`
- `isAllBranchesOfActiveRootLevelPropertyFieldTreeThreadingInMainUiEnabled`
- `isAllBranchesOfActiveRootLevelPropertyFieldTreeThreadingInHoverBreadcrumbEnabled`

The master **Active Cursor Property Field Threading** switch changes activation from hover to focus/caret while preserving whichever regular and root-level threading submodes are enabled.
