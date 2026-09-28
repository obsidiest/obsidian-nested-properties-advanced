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

## Validation status

Local unit tests cover YAML decoding and exact ranges for the screenshot examples, per-mode settings, intact renderer delegation and late resource cleanup, and awaited color saves/failures/theme independence. These use adapters and do not prove desktop rendering.

New desktop suites exercise the real Obsidian renderer, MathJax, SVG, formatting and links in all three modes; restored raw display when a mode is disabled; unchanged note text; and single-click caret retention. A second suite installs the released Style Settings 1.0.9 in the harness's temporary vault and checks its real color controls, on-disk data, CSS and reopening. Results are pending the PR's Windows/Linux runs.

The project typecheck reports eight pre-existing diagnostics outside its validated set; a successful project command is not a claim that unrestricted standalone TypeScript compilation is clean.

Windows manual acceptance in the user's vault remains necessary for the original screenshots, theme/other-plugin combinations, large property trees, embedded images, repeated editing and reopening, and pop-out windows. No merge, tag or release is authorized by this change.
