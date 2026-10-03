/**
 * Images baked into the page at build time: API image URL → static copy under `/baked/`.
 * Islands register the map they got as prop before rendering; afterwards every helper that
 * builds an image URL (`getLeaderImageUrl`, `getInstagramImageUrl`, …) returns the static copy.
 * Data loaded later from the API keeps using it; images without a copy come from the API.
 */

const baked = new Map<string, string>();

// Each page brings its own copies; with Astro's client-side navigation the map would otherwise
// carry over, e.g. into the Leitendenbereich, where a new photo must show instead of the old copy
if (typeof document !== 'undefined') {
  document.addEventListener('astro:before-swap', () => baked.clear());
}

/** API URL → baked URL, as created by `lib/content/images.ts`. */
export type BakedImages = Record<string, string>;

export function registerBakedImages(images: BakedImages | undefined): void {
  for (const [apiUrl, url] of Object.entries(images ?? {})) baked.set(apiUrl, url);
}

/** The baked copy of an image, or the API URL itself. */
export function bakedUrl(apiUrl: string): string {
  return baked.get(apiUrl) ?? apiUrl;
}

/** Points the API image URLs in sanitized HTML (`src`, `srcset`) to their baked copies. */
export function bakedHtml(html: string): string {
  if (baked.size === 0) return html;
  return html.replace(/\/api\/[^\s"',]+/g, (url) => bakedUrl(url));
}
