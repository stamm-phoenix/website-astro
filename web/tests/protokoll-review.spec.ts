import { test, expect } from './fixtures';

test('the writer gives minutes to the review; saving stops and the PDF is a draft', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Review');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown' })
    .click();

  // Typed right before: saved first, then given to the review
  await page.getByLabel('Text zu Punkt 2.').fill('Alles fertig besprochen.');
  await page.getByRole('button', { name: 'Zum Review geben' }).click();
  const confirm = page.getByRole('dialog', { name: 'Zum Review geben?' });
  await confirm.getByRole('button', { name: 'Zum Review geben' }).click();
  await expect(confirm).toBeHidden();

  const review = page.getByRole('region', { name: 'Review und Versand' });
  await expect(review.getByText('Im Review', { exact: true })).toBeVisible();
  await expect(page.getByText('Alles fertig besprochen.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
  // Every leader may approve, the author too after an explicit confirmation
  await expect(review.getByText(/Alle Leitenden können es freigeben/)).toBeVisible();
  await expect(review.getByRole('button', { name: 'Freigeben' })).toBeVisible();

  const download = page.waitForEvent('download');
  await review.getByRole('button', { name: 'PDF-Vorschau' }).click();
  expect((await download).suggestedFilename()).toMatch(/Leitendenrunde Review\.pdf$/);
});

test('the author approves their own draft directly after confirming it', async ({ page }) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Direkt');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown' })
    .click();

  await page.getByLabel('Text zu Punkt 2.').fill('Ohne Review fertig.');
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  const approve = page.getByRole('dialog', { name: '„Leitendenrunde Direkt“ freigeben?' });
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  // Without the tick nothing happens but a hint
  await expect(approve.getByRole('alert')).toContainText('Setz erst das Häkchen');
  await approve.getByRole('checkbox', { name: /ohne zweite Person/ }).check();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve).toBeHidden();

  const review = page.getByRole('region', { name: 'Review und Versand' });
  await expect(review.getByText('Freigegeben', { exact: true })).toBeVisible();
  await expect(review.getByText(/Zum Review gegeben/)).toHaveCount(0);
  await expect(page.getByText('Ohne Review fertig.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
});

test('any leader approves minutes in review and sends them to all leaders', async ({ page }) => {
  await page.goto('/leitendenbereich/protokolle');
  await page
    .getByRole('region', { name: 'Im Editor' })
    .getByRole('link', { name: 'Stavo-Sitzung', exact: true })
    .click();
  const review = page.getByRole('region', { name: 'Review und Versand' });
  await expect(review.getByText('Im Review', { exact: true })).toBeVisible();

  await review.getByRole('button', { name: 'Freigeben' }).click();
  const approve = page.getByRole('dialog', { name: '„Stavo-Sitzung“ freigeben?' });
  // Approving deletes nothing, so it is not shown as a red danger button
  await expect(approve.getByRole('button', { name: 'Freigeben' })).toHaveClass(/btn-primary/);
  // Minutes of someone else need no tick
  await expect(approve.getByRole('checkbox')).toHaveCount(0);
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve).toBeHidden();
  await expect(review.getByText('Freigegeben', { exact: true })).toBeVisible();
  await expect(review.getByRole('link', { name: /Im Protokoll-Ordner öffnen/ })).toBeVisible();
  await expect(review.getByText(/Freigegeben von leitung@example\.test/)).toBeVisible();

  await review.getByRole('button', { name: 'Protokoll verschicken' }).click();
  const send = page.getByRole('dialog', { name: 'Protokoll verschicken?' });
  // The list says why someone is on it; one is taken out and one address is added
  const list = send.getByRole('list', { name: 'Empfänger*innen aus CampFlow' });
  await expect(list.getByText('Label Protokollempfang', { exact: true })).toHaveCount(2);
  await list.getByRole('checkbox', { name: /Karl Kurat/ }).uncheck();
  await expect(send.getByRole('button', { name: 'An 22 Personen schicken' })).toBeVisible();
  await send.getByLabel('Weitere E-Mail-Adresse').fill('gast@example.test');
  await send.getByLabel('Weitere E-Mail-Adresse').press('Enter');
  await expect(send.getByText('gast@example.test hinzugefügt.')).toBeVisible();
  await send.getByRole('button', { name: 'An 23 Personen schicken' }).click();
  await expect(send).toBeHidden();
  await expect(review.getByText('Verschickt', { exact: true })).toBeVisible();
  await expect(review.getByText(/An 23 Personen verschickt am/)).toBeVisible();
  await expect(review.getByRole('button', { name: 'PDF herunterladen' })).toBeVisible();
});

test('a Word approval after a conflict loads the current version and asks again', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/intern/pflege/protokolle/prot-2', (route) => {
    if (route.request().method() !== 'POST' || !fail) return route.continue();
    fail = false;
    return route.fulfill({
      status: 409,
      json: {
        code: 'CONFLICT',
        message: 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.',
      },
    });
  });
  await page.goto('/leitendenbereich/protokolle');
  const item = page.locator('#protokoll-prot-2');
  await item.getByRole('button', { name: 'Freigeben', exact: true }).click();
  const approve = page.getByRole('dialog', { name: '„Stavo-Sitzung“ freigeben?' });
  const tick = approve.getByRole('checkbox', { name: /ohne zweite Person/ });
  await tick.check();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve.getByRole('alert')).toContainText('inzwischen geändert');

  await approve.getByRole('button', { name: 'Aktuelle Fassung laden' }).click();
  await expect(approve.getByRole('alert')).toHaveCount(0);
  await expect(approve.getByRole('button', { name: 'Aktuelle Fassung laden' })).toHaveCount(0);
  // The current version needs its own confirmation
  await expect(tick).not.toBeChecked();
  await tick.check();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve).toBeHidden();
  await expect(item.getByText('Freigegeben', { exact: true })).toBeVisible();
});

test('a newer version after a conflict needs the own approval confirmed again', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Konflikt');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown' })
    .click();
  await page.getByRole('button', { name: 'Zum Review geben' }).click();
  const confirm = page.getByRole('dialog', { name: 'Zum Review geben?' });
  await confirm.getByRole('button', { name: 'Zum Review geben' }).click();
  await expect(confirm).toBeHidden();

  // Someone changed the minutes meanwhile: the approval fails and a newer version loads
  let conflict = false;
  let realEtag = '';
  await page.route('**/api/intern/protokoll-editor/*', async (route) => {
    if (!conflict || route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const json = (await response.json()) as { etag: string };
    realEtag = json.etag;
    return route.fulfill({ response, json: { ...json, etag: 'neuere-fassung' } });
  });
  await page.route('**/api/intern/pflege/protokoll-editor/*/review', (route) => {
    const body = route.request().postDataJSON() as { action: string; etag: string };
    if (body.action !== 'approve') return route.continue();
    if (!conflict) {
      conflict = true;
      return route.fulfill({
        status: 409,
        json: { code: 'CONFLICT', message: 'Das Protokoll wurde inzwischen geändert.' },
      });
    }
    return route.continue({
      postData: JSON.stringify({ ...body, etag: body.etag === 'neuere-fassung' ? realEtag : '' }),
    });
  });

  const review = page.getByRole('region', { name: 'Review und Versand' });
  await review.getByRole('button', { name: 'Freigeben' }).click();
  const approve = page.getByRole('dialog', { name: '„Leitendenrunde Konflikt“ freigeben?' });
  const tick = approve.getByRole('checkbox', { name: /ohne zweite Person/ });
  await tick.check();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve.getByRole('alert')).toContainText('inzwischen geändert');
  // The tick confirmed the old version only
  await expect(tick).not.toBeChecked();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve.getByRole('alert')).toContainText('Setz erst das Häkchen');
  await tick.check();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve).toBeHidden();
  await expect(review.getByText('Freigegeben', { exact: true })).toBeVisible();
});

test('after a refused mail the selection stays and the next try uses the new version', async ({
  page,
}) => {
  let fail = true;
  let bumped = false;
  let snapshot: { items: { etag: string }[] } | null = null;
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/intern/pflege/protokolle/*/versand', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === 'send') {
      bodies.push(body);
      if (fail) {
        fail = false;
        bumped = true;
        return route.fulfill({ status: 500, json: { error: 'Mail abgelehnt' } });
      }
    }
    return route.fallback();
  });
  await page.route(/\/api\/intern\/pflege\/protokolle(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (!bumped) {
      const response = await route.fetch();
      snapshot = JSON.parse(await response.text());
      return route.fulfill({ status: 200, json: snapshot });
    }
    const copy = JSON.parse(JSON.stringify(snapshot)) as { items: { etag: string }[] };
    for (const item of copy.items) item.etag = 'neue-version';
    return route.fulfill({ status: 200, json: copy });
  });
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Protokoll verschicken' }).first().click();
  const send = page.getByRole('dialog', { name: 'Protokoll verschicken?' });
  await send.getByLabel('Weitere E-Mail-Adresse').fill('gast@example.test');
  await send.getByRole('button', { name: 'Hinzufügen' }).click();
  await send.getByRole('checkbox').first().uncheck();
  await send.getByRole('button', { name: 'An 23 Personen schicken' }).click();
  await expect(send.getByText(/Mail abgelehnt|unklar/)).toBeVisible();
  await expect(send.getByText('Von Hand eingetragen')).toBeVisible();
  await send.getByRole('button', { name: 'An 23 Personen schicken' }).click();
  await expect(send).toBeHidden();
  expect(bodies[0].etag).not.toBe('neue-version');
  expect(bodies[1].etag).toBe('neue-version');
  expect(bodies[1].extra).toEqual(['gast@example.test']);
});

test('a changed CampFlow list is reloaded after the refusal and the selection stays', async ({
  page,
}) => {
  let changed = false;
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/intern/pflege/protokolle/*/versand', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === 'send') {
      bodies.push(body);
      if (!changed) {
        changed = true;
        // Shaped like the API's ValidationError: the reason is in `fields.form`
        return route.fulfill({
          status: 400,
          json: {
            error: 'INVALID',
            code: 'INVALID',
            message: 'Die Eingaben sind unvollständig oder ungültig.',
            fields: { form: 'Die Empfänger*innen in CampFlow haben sich geändert.' },
          },
        });
      }
      return route.fallback();
    }
    if (!changed) return route.fallback();
    // Karl Kurat lost the label in CampFlow, the guest got it
    const response = await route.fetch();
    const preview = JSON.parse(await response.text()) as {
      list: { email: string; name: string; reasons: string[] }[];
      recipients: number;
      version: string;
    };
    preview.list = preview.list.filter((r) => r.email !== 'kurat@example.test');
    preview.list.push({
      email: 'gast@example.test',
      name: 'Gerd Gast',
      reasons: ['Label Protokollempfang'],
    });
    preview.recipients = preview.list.length;
    preview.version = 'mock-neu';
    return route.fulfill({ status: 200, json: preview });
  });
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Protokoll verschicken' }).first().click();
  const send = page.getByRole('dialog', { name: 'Protokoll verschicken?' });
  const list = send.getByRole('list', { name: 'Empfänger*innen aus CampFlow' });
  await list.getByRole('checkbox', { name: /Erika Elternbeirat/ }).uncheck();
  await send.getByLabel('Weitere E-Mail-Adresse').fill('gast@example.test');
  await send.getByRole('button', { name: 'Hinzufügen' }).click();
  await send.getByRole('button', { name: 'An 23 Personen schicken' }).click();
  await expect(
    send.getByText(/in CampFlow haben sich geändert\. Es wurde nichts verschickt\./)
  ).toBeVisible();
  await expect(send.getByText(/ist jetzt neu geladen/)).toBeVisible();
  await expect(list.getByText('Karl Kurat')).toHaveCount(0);
  await expect(list.getByRole('checkbox', { name: /Erika Elternbeirat/ })).not.toBeChecked();
  // The added address is on the list now, so its tick decides
  await expect(send.getByText('Von Hand eingetragen')).toHaveCount(0);
  await list.getByRole('checkbox', { name: /Gerd Gast/ }).uncheck();
  await send.getByRole('button', { name: 'An 21 Personen schicken' }).click();
  await expect(send).toBeHidden();
  expect(bodies[1]).toMatchObject({
    version: 'mock-neu',
    excluded: ['elternbeirat@example.test', 'gast@example.test'],
    extra: [],
  });
});
