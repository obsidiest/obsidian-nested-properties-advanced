# Property key regions and breadcrumb navigation — September 11, 2026

Starting point: draft PR #1, `7e85402`, version `2.0.0`. The latest Windows/Obsidian acceptance report supersedes the earlier passing automation. This pass retains the previously accepted history, full-field threading, Source gutter, and timeout controls.

## Recording evidence

All four supplied recordings were inspected as timelines before implementation changes. The two short activation recordings were sampled throughout at 0.2-second intervals. Both navigation recordings were inspected throughout at one-second intervals, then at 0.2-second intervals around click/focus transitions. Video frames show pointer motion, visible caret/highlights, popover replacement, and dismissal; they do not reveal DOM focus or the exact number of native input events.

| Recording | Observed sequence | Implementation and test gap |
| --- | --- | --- |
| Certain Nested Leaf Property Fields… (4.28 s) | The sibling containing `Creator's` has no static connector throughout. The other sibling opens the breadcrumb and threads at about 0.4–1.0, 2.4–2.6, and 4.0–4.2 s; returning to the apostrophe sibling produces neither. Reordering is additional user-reported evidence. | Both the Source tree parser and the separate key-region scanner treated an apostrophe anywhere as opening a quoted key. Existing tests lacked plain keys containing an apostrophe. |
| Full-Width Property Key Hover Activation… (11.84 s) | Leaf key names activate. Root and nested parent key names show their native hover outline/threading but no new breadcrumb. An old leaf breadcrumb may linger through its timeout. The root parent's icon activates at about 10.0–11.6 s. | Key width was clipped at the child value container's left edge even when that container was below the key. Desktop key-scope sweeps checked only the first 8 and 24 pixels, beside the icon. |
| INLIVE~1.MP4 (48.92 s) | Repeated navigation attempts alternate breadcrumb highlighting, scrolling, and occasional visible main-key carets. A caret is visible at the root key end around 4.8–5.2 s and at the nested key end around 35 s; stable retention is inconsistent across attempts. | Navigation only called `focus()`, without setting the caret. Every breadcrumb button's mouseenter also called `focus()`, allowing later hover/reflow to blur the editor. Earlier automation checked immediate focus, not post-dismissal typing. |
| INSOUR~1.MP4 (22.8 s) | Clicking parent entries sometimes shows a caret at the start of the YAML key (e.g. 4–5 s and 20.8–21.0 s). Later motion replaces the breadcrumb and loses the visible caret. | Source navigation explicitly selected the starting column. Hovering breadcrumb buttons could reclaim focus; tests checked the selected line, without asserting its end, retained editor focus, or typing after closure. |

## Corrections

- Source tree identity and key/gutter geometry now share one block-mapping separator scanner. A quote selects a quoted scalar only at the key's beginning. Plain apostrophes, double quotes, and non-separator colons remain key text. Quoted keys retain escaped-quote/backslash handling.
- A value container can shorten a key's active width only when it overlaps that key vertically. Expanded parents keep the complete key region above their children. Inline leaf/collapsed value boundaries remain bounded.
- Hovering a breadcrumb entry highlights its field without moving keyboard focus. A single click or button activation places the caret at the editable key end in Live Preview, or at the YAML property line end in Source. Timeout removal has no caret restoration timer and does not change focus. Keyboard entry through Tab and arrow/Home/End navigation remain available.
- All four timeout defaults are `0.02` seconds. Per-mode numeric labels include `Mode Hover Breadcrumb Popover Timeout`. Saved values and global/individual precedence remain unchanged.

## Validation

Before the production edits, six parser/geometry checks and four navigation-position checks failed on the reported causes. After the corrections, the local unit suite passes 432 tests in 19 files; no-app integration passes 16 tests in two files. The repository typecheck and build pass, retaining the existing eight excluded diagnostics outside the project's validated set.

The desktop suite now also tests both exact sibling names in both orders and all three Source activation scopes, checks visible static/thread connectors, sweeps the actual parent key name, and sends native single clicks followed by typing after the 20 ms timeout. The navigation cases cover root leaves, root parents, nested parents, and nested leaves in main and adopted popout windows.

Windows and Linux Obsidian automation is pending publication of this commit to the existing draft PR. Local scratch has no desktop display/Xvfb. Passing desktop automation will cover its pinned Obsidian/Minimal fixture, not acceptance in the user's actual Windows vault.

## Manual acceptance still needed

1. In the user's note, check both reported sibling fields in Source in both orders: static connectors, all threading modes, and full-field/key/gutter activation.
2. In Live Preview, enable full-key and disable full-field activation. Sweep the complete names of expanded root/nested parents, then compare collapsed parents and leaf key/value boundaries.
3. In both editing modes, open a leaf breadcrumb and single-click each ancestor or leaf. Move across another breadcrumb entry, leave the popover, wait for closure, and type. The caret must remain at the selected key end (Live Preview) or property line end (Source).
4. Inspect the three renamed numerical settings and the four `0.02` defaults with fresh settings. Confirm an existing saved timeout and each enabled individual override survive reload.

Keep PR #1 draft. Do not merge, tag, or publish a 2.0.0 release.
