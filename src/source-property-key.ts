/**
The separator of a block-mapping key, shared by the Source tree and hit regions.
*/
export function findSourceMappingColon(text: string, start = 0): number {
  while (/\s/u.test(text[start] ?? '')) {
    start += 1;
  }
  const quote = text[start];
  let index = start;
  // Only the first character can select a quoted scalar. Quotes embedded in a
  // Plain key (for example Creator's Works) are ordinary key characters.
  if (quote === '"' || quote === '\'') {
    index = findQuotedKeyEnd(text, start, quote);
    if (index === -1) {
      return -1;
    }
    while (/\s/u.test(text[index] ?? '')) {
      index += 1;
    }
    return text[index] === ':' ? index : -1;
  }
  for (; index < text.length; index++) {
    const character = text[index];
    if (character === '#' && (index === start || /\s/u.test(text[index - 1] ?? ''))) {
      return -1;
    }
    // A colon in a plain scalar such as https://example.com is part of the key.
    if (character === ':' && (index + 1 === text.length || /\s/u.test(text[index + 1] ?? ''))) {
      return index === start ? -1 : index;
    }
  }
  return -1;
}

/**
End of editable key text, before separator whitespace or a closing quote.
*/
export function getSourcePropertyKeyEnd(text: string, start: number): number {
  if (text[start] === '-' && (start + 1 === text.length || /\s/u.test(text[start + 1] ?? ''))) {
    return start + 1;
  }
  const quote = text[start];
  if (quote === '"' || quote === '\'') {
    const end = findQuotedKeyEnd(text, start, quote);
    return end === -1 ? start : end - 1;
  }
  const colon = findSourceMappingColon(text, start);
  return colon === -1 ? Math.min(start, text.length) : text.slice(0, colon).trimEnd().length;
}

function findQuotedKeyEnd(text: string, start: number, quote: string): number {
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];
    if (quote === '"' && character === '\\') {
      index += 1;
    } else if (character === quote) {
      if (quote === '\'' && text[index + 1] === '\'') {
        index += 1;
      } else {
        return index + 1;
      }
    }
  }
  return -1;
}
