/** The separator of a block-mapping key, shared by the Source tree and hit regions. */
export function findSourceMappingColon(text: string, start = 0): number {
  while (/\s/u.test(text[start] ?? '')) {
    start += 1;
  }
  const quote = text[start];
  let index = start;
  // Only the first character can select a quoted scalar. Quotes embedded in a
  // Plain key (for example Creator's Works) are ordinary key characters.
  if (quote === '"' || quote === '\'') {
    index += 1;
    let isClosed = false;
    for (; index < text.length; index++) {
      const character = text[index];
      if (quote === '"' && character === '\\') {
        index += 1;
      } else if (character === quote) {
        if (quote === '\'' && text[index + 1] === '\'') {
          index += 1;
        } else {
          index += 1;
          isClosed = true;
          break;
        }
      }
    }
    if (!isClosed) {
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
