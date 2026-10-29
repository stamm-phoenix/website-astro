// The standard fonts of jsPDF know only the characters of Windows-1252. Anything else, such as
// the coloured emoji CampFlow puts in front of a group, would print as garbage.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

function printable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    char === '\n' ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    CP1252_EXTRA.has(char)
  );
}

/** The text without the characters a PDF cannot show („🟠 Wölfling“ → „Wölfling“). */
export function pdfText(text: string): string {
  return [...text.normalize('NFC')]
    .filter(printable)
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}
