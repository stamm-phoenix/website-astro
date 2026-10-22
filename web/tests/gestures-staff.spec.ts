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
 * milliseconds apart, resting `pause` milliseconds before letting go. The events carry these
 * times as their time stamps, so the sheet sees the speed of the finger however busy the
 * machine is. Returns the inline transition of the sheet right after the finger left it.
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
      // Waiting for real would let a busy test machine stretch a step of a flick into a slow
      // pull, so each event gets the time the finger would have reached it
      let time = performance.now();
      const fire = (type: string, y: number): void => {
        const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
        const event = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
        });
        Object.defineProperty(event, 'timeStamp', { value: time });
        target.dispatchEvent(event);
      };
      fire('touchstart', y0);
      for (let index = 1; index <= 10; index++) {
        time += step;
        fire('touchmove', y0 + (dy * index) / 10);
      }
      time += pause;
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

test('a second finger during a pull sends the sheet back open', async ({ page }) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  await page.evaluate(() => {
    const target = document.querySelector('#staff-nav-title');
    if (!target) throw new Error('Sheet missing');
    const box = target.getBoundingClientRect();
    const x = box.left + 20;
    const y0 = box.top + box.height / 2;
    const finger = (id: number, dx: number, y: number): Touch =>
      new Touch({ identifier: id, target, clientX: x + dx, clientY: y });
    const fire = (type: string, touches: Touch[], changed: Touch[]): void => {
      target.dispatchEvent(
        new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches: changed })
      );
    };
    fire('touchstart', [finger(1, 0, y0)], [finger(1, 0, y0)]);
    for (let i = 1; i <= 10; i++) {
      const one = finger(1, 0, y0 + i * 15);
      fire('touchmove', [one], [one]);
    }
    const one = finger(1, 0, y0 + 150);
    const two = finger(2, 60, y0 + 150);
    fire('touchstart', [one, two], [two]);
    fire('touchend', [], [one, two]);
  });
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.getByRole('button', { name: 'Menü', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});
