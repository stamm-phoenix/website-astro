import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { PostfachAnsicht } from '../../api/lib/postfach-model';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1180, height: 820 },
  { width: 1536, height: 960 },
]) {
  test(`mailbox uses page scrolling at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.route('**/api/intern/postfach/kontakt', async (route) => {
      const response = await route.fetch();
      const data: PostfachAnsicht = await response.json();
      const original = data.konversationen.find(
        (mail) => mail.betreff === 'Frage zum Nikolausdienst'
      );
      if (!original) throw new Error('Demo mail missing');
      data.konversationen = Array.from({ length: 93 }, (_, index) => ({
        ...original,
        id: index === 0 ? original.id : `layout-${index}`,
        betreff: index === 0 ? original.betreff : `Testnachricht ${index}`,
      }));
      await route.fulfill({ response, json: data });
    });
    await page.goto('/leitendenbereich/email/kontakt');
    const inbox = page.getByRole('region', { name: 'Posteingang' });
    const mail = inbox.getByRole('link', { name: /Frage zum Nikolausdienst/ });
    await expect(mail).toBeVisible();
    await expect(inbox.getByRole('link')).toHaveCount(93);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('posteingang.png') });
    expect(await inbox.evaluate((element) => getComputedStyle(element).maxHeight)).toBe('none');
    expect(
      await mail.evaluate((element) => {
        for (
          let parent = element.parentElement;
          parent && parent !== document.body;
          parent = parent.parentElement
        ) {
          if (
            ['auto', 'scroll'].includes(getComputedStyle(parent).overflowY) &&
            parent.scrollHeight > parent.clientHeight
          )
            return true;
        }
        return false;
      })
    ).toBe(false);
    await mail.click();
    await expect(page.getByRole('article', { name: 'Frage zum Nikolausdienst' })).toBeVisible();
    if (viewport.width < 1280) {
      await expect(inbox).toBeHidden();
      await page.getByRole('button', { name: /Zur Liste/ }).click();
      await expect(inbox).toBeVisible();
    } else {
      await expect(inbox).toBeVisible();
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const gap = await page
      .locator('footer')
      .evaluate(
        (footer) =>
          document.documentElement.scrollHeight -
          (footer.getBoundingClientRect().bottom + window.scrollY)
      );
    expect(gap).toBeLessThan(100);
  });
}
