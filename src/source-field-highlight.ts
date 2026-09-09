import {
  StateEffect,
  StateField
} from '@codemirror/state';
import {
  Decoration,
  EditorView
} from '@codemirror/view';

const marker = Decoration.line({ class: 'np-property-field-source-highlight' });

export const sourceFieldHighlightEffect = StateEffect.define<null | number>();

/**
CodeMirror owns line attributes; retain a document position, never a painted DOM node.
*/
export const sourceFieldHighlightState = StateField.define<null | number>({
  create: () => null,
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const position = state.field(field);
      return position === null ? Decoration.none : Decoration.set([marker.range(position)]);
    }),
  update: (position, transaction) => {
    let next = position === null ? null : transaction.changes.mapPos(position, 1);
    for (const effect of transaction.effects) {
      if (effect.is(sourceFieldHighlightEffect)) {
        next = effect.value;
      }
    }
    return next === null ? null : transaction.state.doc.lineAt(Math.max(0, Math.min(next, transaction.state.doc.length))).from;
  }
});
