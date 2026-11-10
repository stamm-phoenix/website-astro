import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';

/**
 * Condition-based replacements for fixed waits. Each one waits for something that happens in the
 * page (a frame, a response, a position that stops moving) instead of for a number of seconds,
 * so a slow runner waits longer and a fast one does not wait at all.
 */

/** Resolves after the page painted `frames` more frames, so updates queued by a response are shown. */
export async function settle(page: Page, frames = 3): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const step = (left: number): void => {
          if (left <= 0) resolve();
          else requestAnimationFrame(() => step(left - 1));
        };
        step(count);
      }),
    frames
  );
}

/**
 * Waits until the page has painted for `ms` of its own time. Only for behavior the browser
 * defines by time (the window of a double tap, the pace of a drag gesture): the frames keep
 * counting under load, where a timer of the test runner would be too short or too long.
 */
export async function paintedFor(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (duration) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const step = (): void => {
          if (performance.now() - start >= duration) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    ms
  );
}

/** Waits until two reads of a value, one poll apart, give the same result. */
export async function waitUntilSteady(read: () => Promise<unknown>): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await read());
        const steady = now === last;
        last = now;
        return steady;
      },
      { intervals: [50, 100, 100, 250] }
    )
    .toBe(true);
}

/** Waits until an element stops moving (animation, scrolling, a map that settles). */
export async function waitUntilStill(locator: Locator): Promise<void> {
  await waitUntilSteady(() => locator.boundingBox());
}

/**
 * Resolves after the page has asked the Planung for changes of others `count` times and shown the
 * answers. The page asks on its own every few seconds; this replaces waiting out that period.
 * Call it after the other change was answered, and `await` the result before the next step.
 */
export async function afterPlanungPolls(page: Page, count = 2): Promise<void> {
  const isPoll = (response: Response): boolean =>
    response.url().includes('/api/essensplanung/planung/stand');
  for (let poll = 0; poll < count; poll++) {
    await page.waitForResponse(isPoll, { timeout: 30_000 });
  }
  await settle(page);
}

/** A flag a route handler sets once it has delivered an answer, for the test to wait on. */
export function latch(): { reached: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => (open = resolve));
  return { reached, open };
}

/** Resolves when this very request is over: answered, or cut off by the page that asked again. */
export async function requestOver(request: Request): Promise<void> {
  await request.response().catch(() => null);
}

/**
 * Resolves once the page has had no network traffic for 500 ms and has painted. For a check that
 * something does not happen: a late save, a repeated request or a message that must stay away
 * would have to start a request first, or show up after the next frame.
 */
export async function quiet(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await settle(page);
}
