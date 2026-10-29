/** Text normalisation shared by the validators whose messages differ from `labeledText`. */

/** Trims a string and collapses runs of whitespace; a missing value is `''`, others stay as sent. */
export function collapseText(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  return value === undefined || value === null ? '' : value;
}
