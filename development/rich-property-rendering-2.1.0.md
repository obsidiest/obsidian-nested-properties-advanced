# Rich property rendering and color dialogs — 2.1.0

## Evidence and causes

The supplied Live Preview and Source screenshots show literal LaTeX, inline SVG markup and `[[Testing Document]]` in property keys and breadcrumb rows. They are screenshots, not temporal evidence of clicking or editing.

Before changing implementation, the code paths matched those symptoms: native property inputs displayed strings, breadcrumb buttons used `text`, and the Source tree removed YAML quotes without decoding escape sequences. A renderer added only to the breadcrumb would therefore still receive escaped SVG attributes and math backslashes from Source.

The existing tests covered geometry, pointer regions, caret placement and metadata history. They did not run these labels through Obsidian MarkdownRenderer/MathJax. Their prior success did not establish rich-content rendering.

## Implementation

One shared renderer delegates intact content and the originating note path to Obsidian's `MarkdownRenderer.render` and waits for math rendering. Obsidian retains control of SVG/HTML sanitization. Each surface owns a Component scope that also cleans resources registered after dismissal.

Live Preview and Reading show rendered labels beside inactive native key/value controls. Focusing an input exposes the original syntax; native save/history handlers remain responsible for edits. Source uses exact document ranges in a CodeMirror StateField, including multiline text scalars; the selected property line shows its original YAML. Rendering does not change file text. Breadcrumb labels use the same renderer and resize their guides after asynchronous content/layout changes. Internal links resolve from the originating note.

The global rendering switch and three per-mode switches default to enabled. A disabled global switch disables rendering in all modes.

The color implementation is adapted from [List Tree Indentation Guides 2.0.2](https://github.com/obsidiest/obsidian-list-tree-indentation-guides/tree/1c335fa) (`src/style-settings-colors.ts`, associated precision integration, and dialog CSS). It covers this plugin's 18 themed colors, preserving their actual defaults, schema and `@@light`/`@@dark` storage keys. The four existing fallback/override text-color controls retain their native synchronized pickers. The new dialogs include alpha hex, Default, Cancel/Escape, disabled controls while saving, awaited Style Settings `setSettings()`, retryable errors and unload cleanup. Known malformed hex/non-finite values are repaired only in this plugin's own themed controls during Save; valid stored colors and other plugins are preserved.

## Breadcrumb navigation

The main timeout group is now **Property Field Hover Breadcrumb Popover Timeout**. The **Property Field Hover Breadcrumb** group includes **Property Field Hover Breadcrumb Navigation**, with the requested before-timeout toggle enabled by default and after-timeout toggle disabled by default.

Navigation follows List Tree Indentation Guides 2.0.2's `src/list-breadcrumb.ts`: hovering or keyboard-focusing a row previews its destination without changing the caret; the first preview captures the previous scroll position. Timeout restores that snapshot unless after-timeout navigation is enabled, in which case it keeps or applies the last hovered destination. Escape cancels navigation and restores previews. Clicking commits navigation and establishes a new scroll baseline. Source previews use CodeMirror scroll effects and snapshots; Live Preview/Reading preserve the property editor's scrolling ancestors. Preview scrolling can recycle the Source anchor line without closing the popover. Note edits, mode changes and disconnected views discard stale destinations.

Source key-only hit testing also maps raw YAML positions through CodeMirror's DOM mapping, so rendered labels shorter than their syntax do not extend the key hover region into the value. A focused regression reproduced the bad value hit before this change.

## Validation status

Local unit tests cover YAML decoding and exact ranges for the screenshot examples, per-mode settings, intact renderer delegation and late resource cleanup, and awaited color saves/failures/theme independence. These use adapters and do not prove desktop rendering.

New desktop suites exercise the real Obsidian renderer, MathJax, SVG, formatting and links in all three modes; restored raw display when a mode is disabled; unchanged note text; and single-click caret retention. A second suite installs the released Style Settings 1.0.9 in the harness's temporary vault and checks its real color controls, on-disk data, CSS and reopening. The first Windows/Linux runs each passed 100 of 105 cases. The five new failures exposed test setup errors: rich breadcrumb tests hovered the root while expecting descendants, and color tests captured the settings document before Obsidian could adopt it into a popout. The tests now hover the deepest field and resolve the live settings tab's owner window before trusted native input. Follow-up suites also cover the navigation toggle matrix and Escape in both editing modes, and rendered Source key-only activation. Current platform results are recorded in [draft PR #2](https://github.com/obsidiest/obsidian-nested-properties-advanced/pull/2).

The project typecheck reports eight pre-existing diagnostics outside its validated set; a successful project command is not a claim that unrestricted standalone TypeScript compilation is clean.

Windows manual acceptance in the user's vault remains necessary for the original screenshots, theme/other-plugin combinations, large property trees, embedded images, repeated editing and reopening, and pop-out windows. No merge, tag or release is authorized by this change.
