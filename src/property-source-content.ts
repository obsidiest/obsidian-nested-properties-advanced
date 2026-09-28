import { parseYaml } from 'obsidian';

import {
  flattenPropertyFieldForest,
  parseSourcePropertyFields
} from './property-field-tree.ts';
import { hasRichPropertySyntax } from './rich-property-content.ts';
import {
  findSourceMappingColon,
  getSourcePropertyKeyEnd
} from './source-property-key.ts';

export interface PropertySourceContent {
  readonly editAt: number;
  readonly from: number;
  readonly source: string;
  readonly to: number;
}

interface BlockScalar {
  field?: unknown;
}

/**
Exact document ranges; YAML quotes/escapes are decoded before Markdown.
*/
// eslint-disable-next-line complexity -- YAML scalar forms share the exact source-range calculation; keep their branches together.
export function collectPropertySourceContent(source: string): PropertySourceContent[] {
  const lines = source.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const result: PropertySourceContent[] = [];
  for (const node of flattenPropertyFieldForest(parseSourcePropertyFields(source))) {
    const line = lines[node.line] ?? '';
    const start = offsets[node.line] ?? 0;
    const isSequence = line[node.column] === '-';
    const colon = isSequence ? -1 : findSourceMappingColon(line, node.column);
    if (colon >= 0 && hasRichPropertySyntax(node.key)) {
      result.push({ editAt: start + getSourcePropertyKeyEnd(line, node.column), from: start + node.column, source: node.key, to: start + line.slice(0, colon).trimEnd().length });
    }
    if (colon < 0 && !isSequence) {
      continue;
    }
    const valueColumn = (isSequence ? node.column : colon) + 1;
    const raw = line.slice(valueColumn);
    const contentStart = valueColumn + raw.length - raw.trimStart().length;
    let end = start + line.trimEnd().length;
    let value: unknown;
    try {
      if (/^[|>][\d+-]*(?:\s+#.*)?\s*$/u.test(raw.trim())) {
        let last = node.line;
        while (last + 1 < lines.length) {
          const next = lines[last + 1] ?? '';
          if (next.trim() !== '' && next.length - next.trimStart().length <= node.column) {
            break;
          }
          last++;
        }
        const parsed = parseYaml(`field: ${raw.trim()}\n${lines.slice(node.line + 1, last + 1).join('\n')}`) as BlockScalar;
        value = parsed.field;
        end = (offsets[last] ?? start) + (lines[last]?.length ?? 0);
      } else {
        const scalar = raw.trim();
        value = parseYaml(scalar);
        // Keep a trailing YAML comment visible beside the rendered scalar.
        const comment = findScalarComment(scalar);
        if (comment >= 0) {
          end = start + contentStart + scalar.slice(0, comment).trimEnd().length;
        }
      }
    } catch {
      continue;
    }
    if (typeof value === 'string' && hasRichPropertySyntax(value) && end > start + contentStart) {
      result.push({ editAt: end - (/["']/u.test(source[end - 1] ?? '') ? 1 : 0), from: start + contentStart, source: value, to: end });
    }
  }
  return result.sort((a, b) => a.from - b.from);
}

function findScalarComment(value: string): number {
  const quote = value[0];
  let isInQuote = quote === '"' || quote === '\'';
  for (let index = isInQuote ? 1 : 0; index < value.length; index++) {
    const char = value[index];
    if (isInQuote) {
      if (quote === '"' && char === '\\') {
        index++;
      } else if (char === quote) {
        if (quote === '\'' && value[index + 1] === '\'') {
          index++;
        } else {
          isInQuote = false;
        }
      }
    } else if (char === '#' && (index === 0 || /\s/u.test(value[index - 1] ?? ''))) {
      return index;
    }
  }
  return -1;
}
