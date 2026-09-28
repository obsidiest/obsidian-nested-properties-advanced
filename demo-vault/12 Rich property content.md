---
'test $\approx$ test':
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>':
    '[00 Start](00%20Start.md)': '**Formatted text** and $x^2$'
description: |-
  **Multiline Markdown** with $\alpha + \beta$.
  Visit [00 Start](00%20Start.md) or use `inline code`.
---

# Rich property content

The properties above contain the math, SVG and Markdown link key shapes from the reported rendering failures, plus formatted string values.

1. In **Settings → Nested Properties Advanced → Property Content Rendering**, leave **Render LaTeX, SVG, and Markdown in Properties** enabled. Its Live Preview, Source and Reading controls also start enabled.
2. Expand the nested properties. Compare their rendered keys/values with the hover breadcrumb in each mode. Follow the `00 Start` link to check navigation.
3. In Live Preview, click a rendered label or Tab into its native input to edit the original syntax. In Source, placing the caret on a property line exposes that line's YAML; moving to another line restores its rendered presentation. Rendering does not rewrite the note.
4. Disable one mode's rendering control, then the global control, and compare the plain property labels. Other visual controls remain independent.
5. With Style Settings 1.0.9 enabled, open a guide, thread, or breadcrumb color's **Light** or **Dark** dialog. Save a color, reopen it, and check the stored value. Try an alpha hex value such as `#7aa2f780`, **Default**, **Cancel**, and Escape. Save waits for storage and CSS; a failed save leaves a retryable error in the dialog.

Settings covered: `isRichPropertyRenderingEnabled`, `isRichPropertyRenderingInLivePreviewEnabled`, `isRichPropertyRenderingInSourceModeEnabled`, `isRichPropertyRenderingInReadingModeEnabled`.
