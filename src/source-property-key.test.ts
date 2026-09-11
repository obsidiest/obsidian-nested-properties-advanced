import {
 describe, expect, it
} from 'vitest';

import { findSourceMappingColon } from './source-property-key.ts';

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
});
