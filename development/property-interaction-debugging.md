# Property interaction debugging — September 2026

The user's Windows acceptance report rejects `7f41a5d`: full-width threading and breadcrumbs, Source root/flattened breadcrumbs, and Live Preview Ctrl+Y remain unresolved. The reported intermittent icon activation is newer than the recordings. Earlier test passes and PR descriptions do not supersede that report.

Both uploaded instruction documents and all seven screencasts were reviewed before this pass changed production code. The videos were inspected as ordered interaction sequences, including entry, movement, exit, focus changes, undo, and redo.

| Recording | Observed sequence | Gap in the previous tests |
| --- | --- | --- |
| Full-width field breadcrumb | Native row hover outlines follow the pointer across keys and values while the plugin breadcrumb appears only at limited positions. | A painted native hover state does not establish that the plugin accepted that DOM element. |
| Full-width key breadcrumb | Key text can show its native tooltip without the plugin breadcrumb; after icon entry the breadcrumb can remain beyond the key. | Entry and exit must use the same region, including when elements have different origins. |
| NPA threading | Label/value/blank-space traversal fails to activate the branch consistently; icon interaction can activate it. | Main-window fixtures did not test adopted editor elements. |
| List Tree Indentation Guides 1.1.0 | Threading follows traversal through text, whitespace, and margins, including wrapped rows. | The reference binds pointer movement to its editor surface. The interaction principle is relevant; copying its selectors is insufficient. |
| Live Preview history | After Escape, Ctrl+Z restores the property and scrolls downward; the later Ctrl+Y does not restore the edit. The recording begins after the original edit was made. | Successful replacement alone does not verify native redo, focus ownership, or the viewport. The latest report continues to reject redo. |
| Live Preview / Source comparison | A breadcrumb appears in Live Preview; Source root/empty/flattened fields fail during traversal, while a fold control can activate a breadcrumb. | Source lines and fold controls can come from different DOM realms; a correct YAML parser is insufficient. |
| Icon-only fallback | The breadcrumb remains after the pointer leaves the visible icon and enters its surrounding key area. | The visible icon rectangle, rather than its wrapper, must govern both entry and exit. |

Obsidian moves an existing Markdown leaf into a popout by adopting its DOM. Adoption changes `ownerDocument` but preserves JavaScript prototypes. New children may subsequently be created in either window. Consequently, `element instanceof element.ownerDocument.defaultView.Element` is false for legitimate visible editor elements. Main-window constructor checks fail for the opposite origin. A theme, selector adjustment, delay, or extra fallback cannot make either constructor authoritative for a mixed-origin subtree.

In `7f41a5d`, the pointer handler rejects such elements before resolving the field region. Focus and input handlers also reject them, so the native-history bridge cannot remember the property editor. Its keydown handler can reject the metadata row after Escape as well. Finally, the note lookup treats a rejected target as absent and can choose the first leaf in that document. The nested renderer has analogous checks around its root controls and focus handoff.

The correction uses DOM node identity and the HTML namespace for these boundaries. The current document and containing Markdown view establish ownership; physical pointer coordinates establish the configured field/key/icon region. Activation and deactivation continue to share that region model. History uses the owning Obsidian editor's native undo/redo stack and the existing CodeMirror scroll boundary; it does not introduce text replay or a second history stack.

The diagnostic commit `ded6bf9` changes tests only. With production behavior still identical to `7f41a5d`, real Obsidian 1.13.7 reproduces eight failures on **both Windows and Linux**: Live Preview and Source breadcrumb sweeps, threading in both modes, and root/nested key/value history after moving into a popout. The main-window and reload cases pass. Failed pointer observations explicitly record `ownerRealmElement: false`. The initial history cases fail at undo from editor padding, so `fecad66` adds cases that leave focus on the metadata row after Escape to isolate the reported redo sequence.

The regression suite sends trusted Electron input to the editor's actual window. The integration harness's usual input helpers always address the main window and therefore cannot be used unchanged for this test. Coverage includes Minimal with hidden titles, fresh and existing editors, popout adoption, plugin reload in either window, all four threading submodes, field/key/icon traversal, empty and inline-object Source fields, root/nested key/value edits, and viewport displacement during undo/redo.

The focused unit regression uses a real second DOM realm and demonstrates the old pointer-handler rejection. Many older renderer unit tests use hand-built elements and substituted constructors; they remain tests of renderer logic, not evidence of browser event delivery or multiwindow behavior. Their stubs now declare the DOM identity they represent.

Desktop results are automated runs in real Obsidian with controlled fixtures. They do not establish acceptance in the user's complete Windows vault, theme customization, plugin set, and workspace. The draft PR records validation for its current commit; the user's manual acceptance remains outstanding. Version 2.0.0 stays unreleased.
