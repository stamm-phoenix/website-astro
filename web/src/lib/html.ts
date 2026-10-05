/**
 * Parses HTML into a document, in the browser with its `DOMParser`. During the build there is
 * no DOM; the build-time content layer (`lib/content/`) registers linkedom's parser instead, so
 * the same sanitizers render the baked pages.
 */

interface HtmlParser {
  parseFromString(html: string, type: 'text/html'): Document;
}

let serverParser: HtmlParser | null = null;

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

/** Used by the build only; the browser always takes its own `DOMParser`. */
export function setServerHtmlParser(parser: HtmlParser): void {
  serverParser = parser;
}

/** A document whose body holds `html`; create new nodes with `doc.createElement` etc. */
export function parseHtml(html: string): Document {
  const parser: HtmlParser | null =
    typeof DOMParser === 'undefined' ? serverParser : new DOMParser();
  if (!parser) throw new Error('No HTML parser available');
  // Complete document: linkedom only fills the body of one
  return parser.parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
}

export function isElement(node: Node): node is HTMLElement {
  return node.nodeType === ELEMENT_NODE;
}
