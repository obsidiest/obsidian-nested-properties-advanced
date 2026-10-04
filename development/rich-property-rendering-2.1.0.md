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

### Property typography and icon centering reported at `4d35e9b`

The user's next screenshot showed rendered math, SVG and Markdown keys with oversized text and vertically offset property icons, compared with the plain `Release Types` field. The earlier spacing regression measured only the horizontal gap and did not establish font or vertical alignment correctness.

The cause was located in the released Obsidian stylesheet before editing production CSS: native key inputs use `--metadata-label-font-size`, `--metadata-label-font-weight` and `--input-height`, while the replacement labels inherited note typography and the key's flex container aligned items at the top. A larger font, wrapped label or tall SVG therefore displaced its visual center from the fixed-height icon.

The test-only baseline `e0288f5` reproduced the defect in native Obsidian on Linux: with native keys set to 13 px, rendered keys used 26 px under Default and 16 px under Minimal. Default's icon center was 9.5 px above the rendered content center. All four new typography cases failed while the previous 14 focused rendering/color cases passed.

The fix gives rendered metadata keys the native font size, weight, text color, padding and minimum input height. A vertically centered content column handles short labels; centering the containing key's flex items handles wrapped labels and taller SVGs. The parent alignment applies only while the rendered label is visible, preserving native alignment when editing raw syntax. SVGs retain their authored dimensions, and em-sized SVGs follow the property font.

The four new native cases cover Default/Minimal and Live Preview/Reading. They compare computed font size and weight with `Release Types`, measure icon/content centers within half a pixel, exercise 13 px and 18 px metadata fonts independently of note sizing, toggle full-key expansion to include wrapping, and check a 2.5 em SVG. Existing tests retain Source and breadcrumb coverage. Final platform results are recorded in draft PR #2; the build alone does not verify these runtime behaviors, and the user's vault still needs manual acceptance.

### Property icon spacing reported at `49aaeae`

The user's manual check confirmed rich rendering, but the Live Preview screenshot showed rendered keys pressed against their property icons. The plain `Release Types` key directly above them retained the correct gap. The cause was located before changing the stylesheet: Obsidian 1.13.7 gives `input.metadata-property-key-input` padding through `--metadata-input-padding`, while the replacement `.np-rich-property-label` omitted that inset.

A native Obsidian regression was published before the CSS fix. On Linux, both Default and Minimal measured a zero-pixel icon-to-content gap for all three rendered keys, versus eight pixels for their native inputs and the plain reference key. The fix applies the host's padding variable specifically to rendered labels directly inside `.metadata-property-key`. The regression compares root and nested math, SVG and Markdown keys with the plain reference, in both Live Preview and Reading, under Default and Minimal 8.2.2; it also checks a custom padding variable. Source and breadcrumb rendering keep their existing selectors. Final platform results are recorded in draft PR #2.

### Rendering and interaction checks

Local unit tests cover YAML decoding and exact ranges for the screenshot examples, per-mode settings, intact renderer delegation and late resource cleanup, and awaited color saves/failures/theme independence. These use adapters and do not prove desktop rendering.

New desktop suites exercise the real Obsidian renderer, MathJax, SVG, formatting and links in all three modes; restored raw display when a mode is disabled; unchanged note text; and single-click caret retention. A second suite installs the released Style Settings 1.0.9 in the harness's temporary vault and checks its real color controls, on-disk data, CSS and reopening. The initial Windows/Linux runs each passed 100 of 105 cases. Rich breadcrumb tests incorrectly hovered the root while expecting descendants; corrected tests hover the deepest field. The next run at `a35c8be` passed 112 of 116 on both platforms, including all ten new navigation cases and all six rich-rendering cases. Two history assertions counted intentional breadcrumb preview scrolling; they now measure undo and redo around their respective scroll baselines.

The remaining color failures exposed a real integration gap: Obsidian 1.13.7's separate Settings window is an auxiliary Modal window, absent from workspace leaf enumeration and workspace window events. This was traced in the released application and reproduced with a detached/adopted settings tab before changing the adapter. The adapter now observes the tab's actual document after native `openTab`, supports an already-open tab on plugin reload, and removes window observers and the method patch on unload. Color tests cover both themes in both main and separate Settings windows, and read applied CSS from the note body's actual themed Style Settings selector. Current platform results are recorded in [draft PR #2](https://github.com/obsidiest/obsidian-nested-properties-advanced/pull/2).

The project typecheck reports eight pre-existing diagnostics outside its validated set; a successful project command is not a claim that unrestricted standalone TypeScript compilation is clean.

Windows manual acceptance in the user's vault remains necessary for the original screenshots, theme/other-plugin combinations, large property trees, embedded images, repeated editing and reopening, and pop-out windows. No merge, tag or release is authorized by this change.
