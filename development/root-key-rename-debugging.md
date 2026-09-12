# Root-key Enter/Escape rollback — September 12, 2026

Starting point: draft PR #1, `b663c13`, version `2.0.0`. The user's latest Windows acceptance report takes precedence over earlier passing tests. This pass preserves the accepted hover/threading/history behavior, Source breadcrumb navigation to the key end, and the four `0.01`-second timeout defaults.

## Recording evidence

The complete 27.6-second `1.mp4` recording was inspected as a timeline, then at 0.2-second intervals around the three Enter/Escape transitions. The recording includes a visible keystroke overlay.

| Property | Enter | Escape | Visible outcome |
| --- | --- | --- | --- |
| Root leaf `Fictionality`, renamed to `Test` | About 3.2 s | About 5.0 s | The old name returns around 6.0 s. |
| Root parent `Chronological Release Numbers of the Included Respective Release Types per Creator`, renamed to `Test` | About 13.8 s | About 15.2 s | The old name returns around 16.2 s. |
| Nested leaf `Name`, renamed to `Test` | About 24.0 s | About 25.6 s | The new name remains through the end of the recording. |

The pauses rule out an explanation limited to nearly simultaneous keystrokes. The clip shows Live Preview; correct Source behavior is additional user-reported evidence.

## Cause and reproduction before production edits

Inspection of Obsidian 1.13.7's actual metadata editor found two different records governing the same root-key input:

- `MetadataEditor.synchronize` reuses a rendered root control while passing a new entry object to `renderProperty`.
- Native Enter uses `handleUpdateKey` against the control's current `entry`.
- Native Escape's constructor-installed listener instead reads the entry captured when the control was created.
- Escape restores that stale key into the input and focuses the row. Native blur then treats the old name as a new edit and saves it, reversing the committed rename.

Expanded object widgets can leave focus in the key after Enter because their value-focus callback targets a non-focusable container. Simple text fixtures instead hand focus to their value control. Nested key inputs use the plugin's own editor and do not share the stale native closure.

Test-only commit `fe179a1` triggered a real vault update of a different field, asserted that native metadata synchronization replaced the entry while retaining the key input, and then sent trusted typing, Enter, a one-second pause, and one Escape. It did not require a successful commit or value-focus handoff before Escape.

In [diagnostic run 34670014007](https://github.com/obsidiest/obsidian-nested-properties-advanced/actions/runs/34670014007):

- Linux reproduced the root-parent rollback in both the main and adopted popout windows; 90/92 desktop cases passed.
- Windows reproduced the same rollback in the main window; 90/92 passed. Its parent popout case failed the initial click/focus setup before reaching Enter, so that failure is not counted as a rollback reproduction.
- Both platforms' simple empty/populated root-leaf fixtures and nested-leaf controls passed. These fixtures do not reproduce the recording's specific root-leaf behavior.
- For each actual rollback failure, after Enter the focused key and current entry were `nestedRenamed`, while the original entry remained `nested`. After Escape, the input, current entry, editor text, and saved file had reverted to `nested`.

Earlier history tests began with fresh controls and waited for a successful commit/focus transition. They did not model an entry replaced by metadata refresh followed by Escape while the native key retained focus.

## Correction and regression coverage

An independent editing component captures Escape only for the exact native root-key input belonging to a Live Preview Markdown view. It resolves the owning row in `metadataEditor.rendered` and cancels against that row's current `entry.key`. It then performs native row focus, or native removal for an unnamed new property. Enter, validation, save, and history remain native. The component also observes existing and newly opened windows and removes listeners on unload. Nested keys and Source editing retain their own handlers.

The small control-model tests cover null/text/object values, a subsequent uncommitted draft, cancellation without Enter, cancellation of a new unnamed property, composition, other keys, and already-handled Escape. They model the inspected listener behavior and are not a substitute for desktop checks.

The native suite retains the eight direct Enter/Escape cases and adds six cases that re-enter an already committed root key, type an unfinished second draft, and cancel it. These cover empty/populated leaves and parents in both windows. This explicitly exercises leaf-key cancellation after native value focus without adding a focus precondition to the original reproduction. The edit-click helper parks the pointer outside the note and waits for any breadcrumb to dismiss after popout adoption/metadata refresh; click failures include focus and geometry diagnostics.

## Validation and acceptance boundary

The final candidate's full local typecheck, unit tests, no-app integration tests, build, changed-file lint, and native Windows/Linux desktop results are recorded in PR #1. The native suite runs real Obsidian 1.13.7 with pinned Minimal 8.2.2; the scratch environment has no local desktop runtime/display.

Automated fixture results do not establish acceptance in the user's actual Windows vault. In particular, repeat the recording's root leaf and root parent rename → Enter → Escape sequences, confirm the new names and values persist, then confirm undo/redo still works. Also cancel an unfinished second rename: Escape should return to the most recently committed name. Compare the nested-leaf and Source controls.

Keep PR #1 draft; do not merge, tag, or release `2.0.0`.
