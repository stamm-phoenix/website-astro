import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';
import { senden, werWaehlen } from './essensplanung-packliste-helpers';

test(
  'one thing for everyone: each person ticks their own share',
  { tag: '@mobile' },
  async ({ page, browser }) => {
    test.slow();
    await anlegen(page, 'E2E Packliste für alle');
    await senden(page, 'POST', '/mitglieder', {
      name: 'Alex Rover',
      email: 'alex@example.org',
      rolle: 'bearbeiten',
    });
    await page.reload();
    await page.getByRole('tab', { name: 'Packliste' }).click();
    const neu = page.getByLabel('Noch etwas einpacken');
    await neu.fill('Kochschürze');
    await neu.press('Enter');

    // „Alle“ and another name, at once
    await werWaehlen(page, 'Kochschürze', { alle: true, namen: ['Sam'] });
    await expect(
      page.getByText('Kim Küche, Alex Rover und Sam packen Kochschürze ein.').first()
    ).toBeVisible();
    const liste = page.getByRole('list', { name: 'Packliste' });
    const zeile = liste.locator(':scope > li').filter({ hasText: 'Kochschürze' }).first();
    const anteile = page.getByRole('list', { name: 'Wer hat Kochschürze gepackt?' });
    await expect(anteile.getByRole('checkbox')).toHaveCount(3);
    await expect(zeile).toContainText('0 von 3 gepackt');
    // No box for the whole thing: each packs their own
    await expect(page.getByRole('checkbox', { name: 'Kochschürze', exact: true })).toHaveCount(0);

    // Two people tick their own at once; neither is a conflict
    const anderes = await (await browser.newContext()).newPage();
    await anderes.goto(page.url());
    await anderes.getByRole('tab', { name: 'Packliste' }).click();
    await page.route('**/api/essensplanung/planung/stand*', (route) => route.abort());
    await anderes.getByRole('checkbox', { name: 'Alex Rover hat Kochschürze gepackt' }).check();
    await expect(anderes.getByText('Alex Rover hat Kochschürze eingepackt.').first()).toBeVisible();
    await page.getByRole('checkbox', { name: 'Kim Küche hat Kochschürze gepackt' }).check();
    await expect(page.getByText('Kim Küche hat Kochschürze eingepackt.').first()).toBeVisible();
    await expect(page.getByText(/Jemand anderes hat/)).toHaveCount(0);
    await expect(zeile).toContainText('2 von 3 gepackt');
    await page.unroute('**/api/essensplanung/planung/stand*');
    await anderes.context().close();

    // „Meine“ shows it, as I am one of them; the last tick packs the whole thing
    await page.getByRole('button', { name: 'Meine', exact: true }).click();
    await expect(liste.locator(':scope > li').filter({ hasText: 'Kochschürze' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Alle', exact: true }).click();
    const pdf = await pdfLaden(page, () =>
      page.getByRole('button', { name: 'Packliste als PDF' }).click()
    );
    expect(pdf.text.replace(/\s+/g, ' ')).toContain(
      'Kim Küche (gepackt), Alex Rover (gepackt), Sam'
    );
    await page.getByRole('checkbox', { name: 'Sam hat Kochschürze gepackt' }).check();
    await expect(zeile).toContainText('gepackt');
    await expect(zeile).not.toContainText('von 3');
    await page.getByRole('button', { name: 'Gepackt', exact: true }).click();
    await expect(liste.locator(':scope > li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Alle', exact: true }).click();

    // On the phone the boxes are targets for a finger and nothing is wider than the screen
    await page.setViewportSize({ width: 390, height: 844 });
    const finger = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
    const flaeche = await anteile.locator('label').first().boundingBox();
    expect(flaeche!.height).toBeGreaterThanOrEqual(finger ? 44 : 28);
    await expectNoHorizontalOverflow(page);

    // In the matrix each person's cell is their box
    await page.setViewportSize({ width: 1536, height: 960 });
    await page.getByRole('button', { name: 'Matrix', exact: true }).click();
    const matrix = page.getByRole('grid', { name: 'Packliste als Matrix' });
    await expect(matrix.getByRole('columnheader')).toHaveText([
      'Was',
      /Gepackt\s*1 von 1/,
      /Kim Küche \(du\)\s*1 von 1 gepackt/,
      /Alex Rover\s*1 von 1 gepackt/,
      /Sam\s*1 von 1 gepackt/,
    ]);
    const sam = matrix.getByRole('checkbox', { name: 'Sam hat Kochschürze gepackt' });
    await sam.uncheck();
    await expect(page.getByText('Kochschürze ist für Sam wieder offen.').first()).toBeVisible();
    await expect(
      matrix.getByRole('button', { name: 'Wer packt Kochschürze ein? 2 von 3 gepackt' })
    ).toBeVisible();

    // The read-only link names each one's state
    const { lesen } = await senden<{ links: { lesen: string } }>(page, 'POST', '/links', {
      art: 'lesen',
      an: true,
    }).then((ansicht) => ansicht.links);
    const leser = await (await browser.newContext()).newPage();
    await leser.goto(`/essensplanung/planung#t=${lesen}`);
    await leser.getByRole('tab', { name: 'Packliste' }).click();
    await leser.getByRole('button', { name: 'Liste', exact: true }).click();
    const gelesen = leser.getByRole('list', { name: 'Wer hat Kochschürze gepackt?' });
    await expect(gelesen).toContainText('Kim Küche: gepackt');
    await expect(gelesen).toContainText('Sam: offen');
    await expect(leser.getByRole('checkbox')).toHaveCount(0);
    await leser.context().close();
  }
);
