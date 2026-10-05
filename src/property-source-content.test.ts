import {
  describe,
  expect,
  it
} from 'vitest';

import {
  flattenPropertyFieldForest,
  parseSourcePropertyFields
} from './property-field-tree.ts';
import { collectPropertySourceContent } from './property-source-content.ts';

describe('rendered property source ranges', () => {
  it('decodes the screenshot math, SVG and wikilink keys without changing their source ranges', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10"/></svg>';
    const keys = [String.raw`test $\approx$ test`, svg, '[[Testing Document]]', '**Creator\'s Works**'];
    const lines = keys.map((key, index) => `${'  '.repeat(index)}${JSON.stringify(key)}: ${index === keys.length - 1 ? 'value' : ''}`);
    const source = ['---', ...lines, '---'].join('\n');
    const parts = collectPropertySourceContent(source);
    expect(parts.map((part) => part.source)).toEqual(keys);
    expect(flattenPropertyFieldForest(parseSourcePropertyFields(source)).map((node) => node.key)).toEqual(keys);
    for (const [index, part] of parts.entries()) {
      expect(source.slice(part.from, part.to)).toBe(JSON.stringify(keys[index]));
      expect(source[part.editAt]).toBe('"');
      expect(source.slice(part.to, part.to + 1)).toBe(':');
    }
  });

  it('renders string values and list items while preserving comments and YAML delimiters', () => {
    const source = '---\nplain: \'**bold**\' # comment\n\'Creator\'\'s **Works**\': "[[Testing Document]]"\nitems:\n  - \'$x^2$\'\n  - name: "**Ada**"\nnumber: 12\nobject: { child: value }\n---\n**Body**';
    const parts = collectPropertySourceContent(source);
    expect(parts.map((part) => part.source)).toEqual(['**bold**', 'Creator\'s **Works**', '[[Testing Document]]', '$x^2$', '**Ada**']);
    expect(parts.map((part) => source.slice(part.from, part.to))).toEqual(['\'**bold**\'', '\'Creator\'\'s **Works**\'', '"[[Testing Document]]"', '\'$x^2$\'', '"**Ada**"']);
    expect(parts.every((part, index) => index === 0 || (parts[index - 1]?.to ?? 0) <= part.from)).toBe(true);
  });

  it('renders a literal multiline scalar as one range and leaves its sibling intact', () => {
    const source = '---\nparent:\n  description: |-\n    **first**\n    $x^2$\n  sibling: plain\n---';
    const parts = collectPropertySourceContent(source);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.source).toBe('**first**\n$x^2$');
    expect(source.slice(parts[0]?.from, parts[0]?.to)).toBe('|-\n    **first**\n    $x^2$');
    expect(source.slice(parts[0]?.to)).toBe('\n  sibling: plain\n---');
  });

  it('keeps hash marks inside quoted Markdown and ignores plain fields and invalid scalars', () => {
    const source = '---\nlink: "[go](#heading)" # trailing\nplain: text\ninvalid: "unterminated **bold**\n---';
    const parts = collectPropertySourceContent(source);
    expect(parts.map((part) => part.source)).toEqual(['[go](#heading)']);
    expect(source.slice(parts[0]?.from, parts[0]?.to)).toBe('"[go](#heading)"');
    expect(collectPropertySourceContent('**ordinary body**')).toEqual([]);
  });
});
