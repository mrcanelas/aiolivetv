export function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
      const hexadecimal = entity[1].toLowerCase() === 'x';
      const code = Number.parseInt(
        entity.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10
      );
      return Number.isInteger(code) &&
        code >= 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : match;
    }
  );
}
