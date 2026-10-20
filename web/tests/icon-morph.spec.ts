import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Icons of two-state controls change shape like the hamburger: the parts turn, fold or grow
 * with transform/opacity. Each test checks the end state, that a transition really runs, that a
 * quick second toggle ends where it started, and that Reduced Motion switches without movement.
 */

/** Expected computed values of one part; `transform` as a CSS transform list ('none' = identity). */
interface PartEnd {
  transform?: string;
  rotate?: string;
  opacity?: number;
}

type Parts = Record<string, Locator>;
type States = Record<string, PartEnd>;

/** Whether every part shows its expected value (transforms compared with a small tolerance). */
async function reached(parts: Parts, states: States): Promise<boolean> {
  for (const [key, expected] of Object.entries(states)) {
    const ok = await parts[key].evaluate((element, end) => {
      const style = getComputedStyle(element);
      if (end.rotate !== undefined && style.rotate !== end.rotate) return false;
      if (end.opacity !== undefined && Math.abs(Number(style.opacity) - end.opacity) > 0.001) {
        return false;
      }
      if (end.transform !== undefined) {
        const actual = new DOMMatrixReadOnly(style.transform === 'none' ? '' : style.transform);
        const wanted = new DOMMatrixReadOnly(end.transform === 'none' ? '' : end.transform);
        const keys = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
        if (keys.some((name) => Math.abs(actual[name] - wanted[name]) > 0.001)) return false;
      }
      return true;
    }, expected);
    if (!ok) return false;
  }
  return true;
}

/** Durations (ms) of the transitions currently on the parts. */
async function transitionDurations(parts: Parts): Promise<number[]> {
  const all = await Promise.all(
    Object.values(parts).map((part) =>
      part.evaluate((element) =>
        element
          .getAnimations()
          .filter((animation) => animation.playState === 'running')
          .map((animation) => Number(animation.effect?.getTiming().duration))
      )
    )
  );
  return all.flat();
}

async function expectState(parts: Parts, states: States): Promise<void> {
  await expect.poll(() => reached(parts, states), { timeout: 5_000 }).toBe(true);
}

/**
 * Runs the four checks on a control whose icon shows `start` now. `toggle` switches it once,
 * `settle` waits until it can be switched again (e.g. a label changed).
 */
async function checkMorph(
  page: Page,
  toggle: () => Promise<void>,
  parts: Parts,
  start: States,
  end: States
): Promise<void> {
  await expectState(parts, start);
  // Animations run at a tenth of their speed, so a busy test machine still sees them running.
  // Their set duration stays what the page asks for.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });

  // A short transition runs right after the switch, and ends in the other shape
  await toggle();
  const durations = await transitionDurations(parts);
  expect(durations.length, 'a transition runs after toggling').toBeGreaterThan(0);
  for (const duration of durations) {
    expect(duration).toBeGreaterThanOrEqual(120);
    expect(duration).toBeLessThanOrEqual(220);
  }
  await expectState(parts, end);
  await expect.poll(() => transitionDurations(parts)).toEqual([]);

  // Toggled twice in quick succession: back where it was, nothing left halfway
  await toggle();
  // A moment later the icon is still on its way
  expect((await transitionDurations(parts)).length, 'still turning').toBeGreaterThan(0);
  await toggle();
  await expectState(parts, end);
  await expect.poll(() => transitionDurations(parts)).toEqual([]);

  // Reduced Motion: the shape changes without a visible transition
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle();
  for (const duration of await transitionDurations(parts)) {
    expect(duration).toBeLessThanOrEqual(0.01);
  }
  await expectState(parts, start);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await cdp.detach();
}

test('the theme switch turns the moon into the sun and back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Dunkles Theme', exact: true });
  await expect(button).toBeVisible();
  const parts = {
    moon: button.locator('[data-theme-icon="moon"]'),
    core: button.locator('[data-theme-icon="sun-core"]'),
    rays: button.locator('[data-theme-icon="sun-rays"]'),
  };
  const moon: States = {
    moon: { opacity: 1, transform: 'none' },
    core: { opacity: 0, transform: 'scale(2.1)' },
    rays: { opacity: 0, transform: 'rotate(-45deg) scale(0.5)' },
  };
  const sun: States = {
    moon: { opacity: 0, transform: 'rotate(45deg) scale(0.47)' },
    core: { opacity: 1, transform: 'none' },
    rays: { opacity: 1, transform: 'none' },
  };
  let pressed = false;
  await checkMorph(
    page,
    async () => {
      await button.click();
      pressed = !pressed;
      // The state is there at once, it does not wait for the icon
      await expect(button).toHaveAttribute('aria-pressed', String(pressed));
    },
    parts,
    moon,
    sun
  );
  // A page that loads in the dark theme shows the sun without turning it first
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await transitionDurations(parts)).toEqual([]);
  expect(await reached(parts, sun)).toBe(true);
});

test('a disclosure chevron turns with its answer', async ({ page }) => {
  await page.goto('/fragen-und-antworten');
  await expect(page.locator('astro-island[component-url*="QAList"]')).not.toHaveAttribute('ssr');
  const question = page.getByRole('main').locator('button[aria-expanded]').first();
  const parts = { chevron: question.locator('.disclosure-icon') };
  let open = false;
  await checkMorph(
    page,
    async () => {
      await question.click();
      open = !open;
      await expect(question).toHaveAttribute('aria-expanded', String(open));
    },
    parts,
    { chevron: { rotate: 'none' } },
    { chevron: { rotate: '180deg' } }
  );
});

test('the plus of the Nikolaus FAQ turns into a cross, also without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  await page.goto(`${baseURL}/nikolaus`);
  const item = page.locator('details.faq-item').first();
  const summary = item.locator('summary');
  await summary.scrollIntoViewIfNeeded();
  const parts = { plus: summary.locator('.disclosure-icon') };
  let open = false;
  await checkMorph(
    page,
    async () => {
      await summary.click();
      open = !open;
      await expect(item).toHaveJSProperty('open', open);
    },
    parts,
    { plus: { rotate: 'none' } },
    { plus: { rotate: '45deg' } }
  );
  await context.close();
});

test('the arrow of the sidebar turns to where the sidebar goes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The sidebar is only there from 1280px');
  await page.goto('/leitendenbereich/belege');
  await expect(page.locator('astro-island[component-url*="StaffSidebar"]')).not.toHaveAttribute(
    'ssr'
  );
  const sidebar = page.getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' });
  const fold = sidebar.locator('button[aria-expanded]').first();
  const parts = { arrow: fold.locator('.sidebar-arrow') };
  let expanded = true;
  await checkMorph(
    page,
    async () => {
      await fold.click();
      expanded = !expanded;
      await expect(fold).toHaveAttribute('aria-expanded', String(expanded));
    },
    parts,
    { arrow: { rotate: 'none' } },
    { arrow: { rotate: '180deg' } }
  );
});

test('the zoom button folds the plus into a minus', async ({ page }) => {
  await page.goto(
    `/leitendenbereich/fotos#pfad=${encodeURIComponent('Aktionen/2026/Sommerlager Westernohe/Nico')}`
  );
  await page.getByRole('button', { name: 'IMG_4301.jpg groß anzeigen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'IMG_4301.jpg', exact: true })).toBeVisible();
  const button = dialog.getByRole('button', { name: /^(Vergrößern|Verkleinern)$/ });
  const parts = { bar: button.locator('.zoom-bar') };
  let zoomed = false;
  await checkMorph(
    page,
    async () => {
      await button.click();
      zoomed = !zoomed;
      await expect(button).toHaveAccessibleName(zoomed ? 'Verkleinern' : 'Vergrößern');
    },
    parts,
    { bar: { transform: 'none' } },
    { bar: { transform: 'scaleY(0)' } }
  );
});

test('the star of a favorite fills from its middle', async ({ page }, testInfo) => {
  await page.goto('/leitendenbereich');
  const star = page
    .getByRole('region', { name: 'Kasse & Material' })
    .getByRole('button', { name: 'Belege als Favorit', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  const parts = { fill: star.locator('.star-fill') };
  let active = false;
  await checkMorph(
    page,
    async () => {
      if (testInfo.project.name === 'desktop') {
        await star.locator('..').hover();
        await star.click();
      } else {
        // On a touch screen a long press on the row toggles it (tests/favorites-helpers.ts);
        // the star itself lets taps through, so the click goes to it directly here.
        await star.dispatchEvent('click');
      }
      active = !active;
      await expect(star).toHaveAttribute('aria-pressed', String(active));
    },
    parts,
    { fill: { opacity: 0, transform: 'scale(0.4)' } },
    { fill: { opacity: 1, transform: 'none' } }
  );
});
