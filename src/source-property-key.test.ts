import {
 describe, expect, it
} from 'vitest';

import {
 findSourceMappingColon, getSourcePropertyKeyEnd
} from './source-property-key.ts';

describe('Source block-mapping key boundaries', () => {
  it.each([
    'Creator\'s Works',
    'An unmatched " within a plain key',
    'https://example.com',
    'flow[key:part]',
    '\'Creator\'\'s: Works\'',
    String.raw`"escaped \" colon: key"`,
    String.raw`"ends in escaped backslash\\"`
  ])('should share the complete boundary of %s between the tree and hover regions', (key) => {
    expect(findSourceMappingColon(`    ${key}: value: with a colon`)).toBe(key.length + 4);
  });

  it.each(['not a mapping', '# comment: text', 'plain # comment: text', '"unclosed: key', '\'unclosed: key', ': missing-key'])('should ignore non-mapping line %s', (text) => {
    expect(findSourceMappingColon(text)).toBe(-1);
  });

  it.each([
    { column: 0, marked: 'root|: value' },
    { column: 2, marked: '  child|   : value' },
    { column: 2, marked: '  Creator\'s Works|: value' },
    { column: 2, marked: '  https://example.com|: value' },
    { column: 2, marked: '  "quoted: key|" : value' },
    { column: 2, marked: '  \'Creator\'\'s Works|\': value' },
    { column: 2, marked: String.raw`  "escaped \"key\"|": value` },
    { column: 2, marked: '  -| child: value' },
    { column: 4, marked: '  - child|: value' }
  ])('should place the editable key-end caret at the marked position in $marked', ({ column, marked }) => {
    expect(getSourcePropertyKeyEnd(marked.replace('|', ''), column)).toBe(marked.indexOf('|'));
  });
});
