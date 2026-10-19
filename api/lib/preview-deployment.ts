/**
 * Helpers of the deploy workflow for PR previews: they set the values of `deployment.ts` and
 * find the preview of the Playwright API that belongs to a website PR. Free of I/O, so they can
 * be tested.
 */

/** Names of the values in `deployment.ts`. */
export type DeploymentValue = 'PREVIEW_DATABASE' | 'PREVIEW_CONTAINER' | 'PREVIEW_PLAYWRIGHT_API';

/** `deployment.ts` with one value replaced; the other values stay as they are. */
export function setDeploymentValue(
  source: string,
  name: DeploymentValue,
  value: string | null
): string {
  const line = new RegExp(`^export const ${name}: string \\| null = .*;$`, 'm');
  if (!line.test(source)) throw new Error(`${name} is missing in deployment.ts`);
  const literal = value === null ? 'null' : `'${value.replace(/[\\']/g, '\\$&')}'`;
  return source.replace(line, `export const ${name}: string | null = ${literal};`);
}

/**
 * A playwright-api PR named in the description of a website PR, as `playwright-api#12` or as
 * its link; `null` if none is named.
 */
export function linkedPlaywrightPr(body: string | null | undefined): number | null {
  const match = (body ?? '').match(
    /(?:^|[\s(/])(?:stamm-phoenix\/)?playwright-api(?:#|\/pull\/)(\d+)\b/
  );
  return match ? Number(match[1]) : null;
}

/**
 * The URL of a playwright-api PR preview: the label `pr-<number>` of the same Container App,
 * `https://<app>---pr-<number>.<environment domain>` (playwright-api `docs/pr-previews.md`).
 */
export function playwrightPreviewUrl(productionUrl: string, pr: number): string {
  const url = new URL(productionUrl);
  const [app, ...domain] = url.hostname.split('.');
  url.hostname = [`${app}---pr-${pr}`, ...domain].join('.');
  return url.origin;
}
