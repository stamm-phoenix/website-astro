// Text for the standard fonts of jsPDF, which only know the characters of Windows-1252: emoji
// and symbols such as „🟠 Wölfling“ would come out as garbage.

/** Characters of Windows-1252 above Latin-1 (0x80–0x9F). */
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

function printable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(char);
}

/**
 * Keeps what the PDF can print: a letter with an accent it does not know loses the accent („ș“
 * becomes „s“), emoji and other symbols are left out. Line breaks stay.
 */
export function pdfText(value: string): string {
  return value
    .split('\n')
    .map((line) =>
      // Tabs and other spaces (e.g. a narrow no-break space) stay a gap between the words
      [...line.replace(/[\t\p{Zs}]/gu, ' ')]
        .map((char) => {
          if (printable(char)) return char;
          const base = char.normalize('NFD').replace(/\p{M}/gu, '');
          return [...base].every(printable) ? base : '';
        })
        .join('')
        .replace(/ +/g, ' ')
        .trim()
    )
    .join('\n');
}
