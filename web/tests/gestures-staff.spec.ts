import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// The sheet „Alle Bereiche“ on a phone finishes a swipe at the speed the finger left it.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'Touch gestures of the phone bar only');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/gruppenstunden');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
});

/**
 * Opens the sheet with „Menü“ and waits until it rests in its open place.
 */
async function openSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
}

/**
 * Swipes one finger down the title of the sheet by `dy` pixels in ten moves `step`
 * milliseconds apart, resting `pause` milliseconds before letting go. The time between the
 * events is real, so the sheet sees the speed of the finger. Returns the inline transition
 * of the sheet right after the finger left it.
 */
async function swipeSheet(
  page: Page,
  dy: number,
  { step = 30, pause = 0 }: { step?: number; pause?: number } = {}
): Promise<string> {
  return page.evaluate(
    async ({ dy, step, pause }) => {
      const panel = document.querySelector<HTMLElement>('#staff-nav-panel');
      const target = document.querySelector('#staff-nav-title');
      if (!panel || !target) throw new Error('Sheet missing');
      const box = target.getBoundingClientRect();
      const x = box.left + 20;
      const y0 = box.top + box.height / 2;
      const fire = (type: string, y: number): void => {
        const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [touch],
            changedTouches: [touch],
          })
        );
      };
      // The moves wait on the clock itself: timers of a busy test machine fire late, which
      // would turn a flick into a slow pull
      const hold = (ms: number): void => {
        const end = performance.now() + ms;
        while (performance.now() < end) {
          // Real time passes between the events, as with a finger
        }
      };
      fire('touchstart', y0);
      for (let index = 1; index <= 10; index++) {
        hold(step);
        fire('touchmove', y0 + (dy * index) / 10);
      }
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
      fire('touchend', y0 + dy);
      // Svelte applies the state of the release in a microtask
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      return panel.style.transition;
    },
    { dy, step, pause }
  );
}

/** The duration of an inline `transform` transition in milliseconds; null for `none`. */
function transformMs(transition: string): number | null {
  const match = /transform (\d+(?:\.\d+)?)ms/.exec(transition);
  return match ? Number(match[1]) : null;
}

test('a quick flick down closes the sheet faster than a slow pull past the threshold', async ({
  page,
}) => {
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });

  await openSheet(page);
  // Slowly past a third of the height, resting before letting go: the full panel duration
  const slow = transformMs(await swipeSheet(page, 550, { step: 30, pause: 200 }));
  await expect(sheet).toBeHidden();

  await openSheet(page);
  // The same distance as a flick: the rest goes on at the speed of the finger
  const fast = transformMs(await swipeSheet(page, 550, { step: 6 }));
  await expect(sheet).toBeHidden();

  expect(slow).toBe(220);
  expect(fast).not.toBeNull();
  expect(fast!).toBeGreaterThan(0);
  expect(fast!).toBeLessThan(slow!);
});

test('a short slow pull springs back open', async ({ page }) => {
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  await openSheet(page);
  const transition = await swipeSheet(page, 60, { step: 30, pause: 200 });
  expect(transformMs(transition)).toBe(220);
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Menü', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});

test('with Reduced Motion a swipe closes the sheet at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  await openSheet(page);
  expect(await sheet.evaluate((node) => node.style.transition)).toBe('none');
  const transition = await swipeSheet(page, 450, { step: 4 });
  expect(transition).toBe('none');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Menü', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});
