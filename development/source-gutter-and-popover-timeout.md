# Source gutters and hover breadcrumb timeout — September 10, 2026

The user's latest Windows testing accepts the progress in `aa0029f` on full-width activation, threading, and Live Preview redo. The remaining report concerns Source leaf gutters and reaching the breadcrumb's navigation controls. This report supersedes the earlier rejection of `7f41a5d` for those accepted behaviors.

All three new MP4s were inspected as ordered pointer sequences before production changes, at 0.2-second intervals across their complete durations.

| Recording | Temporal evidence |
| --- | --- |
| `SOURCE~2.MP4` (7.68 s) | Traversal beside the root `Release Types` leaf does not open a breadcrumb. A parent control opens one at about 1.2–1.8 s; the nested `Release Type (1)` parent does so at about 3.2 s. Traversal beside nested `Name` leaves through the end moves threading but does not open a breadcrumb. |
| `Hover Breadcrumb Popover Timeout is Too Short - Source Mode.mp4` (4.2 s) | The `Manga` breadcrumb is initially visible. Movement toward its rows causes the displayed hierarchy to change to underlying properties around 1.2–1.6 s, then similar changes recur around 2.4–3.0 s. The recording demonstrates interrupted handoff, not a measurement of a particular timeout value. |
| `Hover Breadcrumb Popover Timeout is Too Short at Times - Live Preview Mode.mp4` (4.68 s) | The initial `Manga` breadcrumb disappears during movement toward navigation around 1.2–1.4 s. It reopens around 2.4 s and disappears again around 3.0 s. |

## Causes and changes

The Source interaction model populated its fallback region only from existing fold-control DOM. Leaves have no such control. The key region also began at the rendered line/text edge, leaving the hypothetical fold slot outside the key scope. Source regions now include a slot immediately before the first YAML character, derived from CodeMirror coordinates and line height. Indentation and horizontal scrolling are included in those coordinates. Actual fold-control rectangles are included as well. Property identity still comes from the rendered CodeMirror line and parsed frontmatter; no expander or click behavior is added to leaves.

Popover dismissal had several immediate-removal paths which bypassed its 120 ms timer. The gap between an anchor and its popover can also lie over another property, so pointer travel could replace the hierarchy before the pointer reached it. Ordinary exits now clear field activation immediately but retain the popover through one timer. Repeated movement outside does not restart that timer. The geometric gap preserves the current hierarchy; entering the popover cancels dismissal. Mode changes, window loss, and invalid owners still clean up their obsolete UI.

An unused Source hover helper and its isolated DOM test were removed: they did not exercise the runtime region model. Their coverage is replaced with tests of the component's actual pointer path and gutter geometry. The old immediate-visibility assertions were updated to distinguish deactivation of a field from the new, explicitly requested popover timeout.

## Timeout controls

The main settings section is **Hover Breadcrumb Popover Timeout**. Global control defaults to enabled; all three individual controls default to disabled. Inputs use seconds, accept decimals and zero, and default to 1 second.

| Individual control for this mode | Global control | Effective timeout |
| --- | --- | --- |
| Enabled | Either state | That mode's numerical value |
| Disabled | Enabled | Global numerical value |
| Disabled | Disabled | Built-in 1-second default |

Zero dismisses immediately. Invalid, negative, non-finite, or browser-overflowing values are rejected. Numeric edits preserve the native number input while typing and pressing Enter; Boolean changes refresh dependent controls. Persistence continues through the plugin's existing settings component.

## Validation boundary

Before the production correction, focused unit regressions failed in Source key and fallback scope and on immediate popover removal; the full-field control case passed. Those failures reproduce the identified paths. New desktop tests use trusted Electron pointer travel through the actual anchor/popover gap, pause there, enter navigation rows, wait through an individual timeout, and click an ancestor. They cover all three viewing modes in main and adopted popout windows. Source gutter sweeps cover parent, leaf, empty, and flattened fields under all four scope-toggle combinations. A native settings test types a decimal value, presses Enter, and reloads the plugin to check persistence.

The current draft PR records final automated results for its head commit. These controlled tests in real Obsidian do not establish acceptance in the user's complete Windows vault. Version 2.0.0 remains draft and unreleased.
