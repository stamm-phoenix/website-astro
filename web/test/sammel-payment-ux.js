// Playwright CLI callback. Uses fictional API responses and makes no financial requests.
export default async function sammelPaymentUx(page) {
  const results = [];
  await page.unrouteAll();
  const now = '2026-10-01T14:00:00.000Z';
  const actor = { id: 'staff', name: 'staff@example.test' };
  const person = {
    id: 'per_A',
    name: 'Anna Test',
    emails: ['family@example.test'],
    matchesEmail: true,
  };
  const campaignBase = {
    id: '1',
    etag: '"campaign,1"',
    title: 'Sammelbestellung Herbst 2026',
    description: 'Gemeinsam bestellen.',
    startsAt: '2026-01-01',
    endsAt: '2027-01-01',
    archived: false,
    catalog: [],
  };
  const orderBase = {
    id: '2',
    etag: '"order,1"',
    campaignId: '1',
    name: 'Familie Test',
    email: 'family@example.test',
    items: [
      { name: 'Kluft', reference: 'https://www.ruesthaus.de/1/kluft', variant: '164', quantity: 2 },
    ],
    notes: '',
    status: 'Bestellt',
    submitted: true,
    paid: false,
    delivered: false,
    totalCents: 4800,
  };
  let state;
  let releaseCreate;
  const heldCreate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  const reset = (scenario) => {
    person.name = 'Anna Test';
    const order = structuredClone(orderBase),
      campaign = structuredClone(campaignBase);
    const record = {
      version: 1,
      assignment: { person, reason: '', confirmedBy: actor, confirmedAt: now },
      operation: null,
      dispatch: null,
      settlement: null,
    };
    const snapshot = {
      personId: person.id,
      amount: 4800,
      description: campaign.title + ' · Bestellung 2',
      orderId: '2',
      campaignId: '1',
      revision: 'a'.repeat(64),
      attachedExpense: { costunitName: campaign.title, categoryName: 'Bestellungen' },
    };
    if (scenario === 'missing' || scenario === 'unpriced') {
      order.totalCents = null;
      order.status = 'Eingereicht';
    }
    if (scenario === 'zero') order.totalCents = 0;
    if (scenario === 'paid') order.paid = true;
    if (scenario === 'archived') campaign.archived = true;
    if (
      ['uncertain', 'prepared', 'created', 'adopt-validation', 'dispatch-validation'].includes(
        scenario
      )
    ) {
      const status =
        scenario === 'prepared'
          ? 'prepared'
          : scenario === 'uncertain' || scenario === 'adopt-validation'
            ? 'uncertain'
            : 'created';
      record.operation = {
        key: '00000000-0000-0000-0000-000000000001',
        hash: 'a'.repeat(64),
        snapshot,
        state: status,
        startedAt: now,
        attemptedAt: status === 'prepared' ? null : now,
        contribution: status === 'created' ? { id: 'fee_Test', reference: 'GC12345' } : null,
        errorCategory: status === 'uncertain' ? 'timeout' : null,
      };
      order.payment = {
        locked: true,
        state: status,
        reference: record.operation.contribution?.reference ?? null,
        requestSentAt: null,
        paymentMarkedAt: null,
      };
    }
    if (scenario === 'long') {
      order.name = 'SehrLangerFamilienname'.repeat(10);
      campaign.title = 'Sammelbestellung ' + 'LangerAktionsname'.repeat(11);
      person.name = 'SehrLangerMitgliedsname'.repeat(8);
      snapshot.attachedExpense.costunitName = campaign.title;
    }
    state = {
      scenario,
      order,
      campaign,
      snapshot,
      view: { order, record, events: [], creationEnabled: scenario !== 'disabled' },
      posts: [],
      creates: 0,
      gets: 0,
    };
  };
  await page.route('**/.auth/me', (route) =>
    route.fulfill({
      json: {
        clientPrincipal: {
          identityProvider: 'aad',
          userId: 'staff',
          userDetails: 'staff@example.test',
          userRoles: ['authenticated'],
        },
      },
    })
  );
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path === '/api/intern/pflege/sammelbestellungen/1')
        return route.fulfill({
          json: {
            campaign: state.campaign,
            invitationUrl: 'https://example.test',
            orders: [state.order],
          },
        });
      if (path.endsWith('/product'))
        return route.fulfill({
          json: {
            name: 'Kluft',
            unitPriceCents: state.scenario === 'unpriced' ? null : 2400,
            imageUrl: null,
            sourceUrl: 'https://www.ruesthaus.de/1/kluft',
          },
        });
      if (path.endsWith('/payment/persons')) return route.fulfill({ json: [person] });
      if (path.endsWith('/payment')) {
        if (req.method() === 'GET') {
          state.gets++;
          if (
            state.scenario === 'offline' ||
            (state.scenario === 'reload-failure' && state.gets > 1)
          )
            return route.fulfill({
              status: 503,
              json: { message: 'Zahlungsstand nicht erreichbar.' },
            });
          return route.fulfill({ json: state.view });
        }
        const body = req.postDataJSON();
        state.posts.push(body.action);
        if (body.action === 'preview')
          return route.fulfill({
            json: {
              etag: state.order.etag,
              snapshot: state.snapshot,
              hash: 'a'.repeat(64),
              personName: person.name,
            },
          });
        if (body.action === 'adopt' && state.scenario === 'adopt-validation')
          return route.fulfill({
            status: 400,
            json: {
              code: 'VALIDATION_ERROR',
              message: 'Bitte Angaben korrigieren.',
              fields: { feeId: 'Bitte eine gültige Beitrags-ID eingeben.' },
            },
          });
        if (body.action === 'dispatched' && state.scenario === 'dispatch-validation')
          return route.fulfill({
            status: 400,
            json: {
              code: 'VALIDATION_ERROR',
              message: 'Bitte Angaben korrigieren.',
              fields: { evidence: 'Bitte den Versandnachweis ergänzen.' },
            },
          });
        if (body.action === 'create') {
          if (state.scenario === 'conflict') {
            state.order.etag = '"order,2"';
            state.order.totalCents = 5400;
            return route.fulfill({
              status: 409,
              json: { message: 'Die Bestellung wurde inzwischen geändert.' },
            });
          }

          state.creates++;
          if (state.scenario === 'double') await heldCreate;
          state.view.record.operation = {
            key: '00000000-0000-0000-0000-000000000001',
            hash: 'a'.repeat(64),
            snapshot: state.snapshot,
            state: 'created',
            startedAt: now,
            attemptedAt: now,
            contribution: { id: 'fee_Test', reference: 'GC12345' },
            errorCategory: null,
          };
          state.order.payment = {
            locked: true,
            state: 'created',
            reference: 'GC12345',
            requestSentAt: null,
            paymentMarkedAt: null,
          };
          if (state.scenario === 'create-uncertain') {
            state.view.record.operation.state = 'uncertain';
            state.view.record.operation.contribution = null;
            state.order.payment.state = 'uncertain';
            state.order.payment.reference = null;
            return route.fulfill({
              status: 502,
              json: { message: 'Das Ergebnis ist unklar. Bitte in CampFlow prüfen.' },
            });
          }
          if (['lost-success', 'reload-failure'].includes(state.scenario))
            return route.abort('failed');
        }
        return route.fulfill({ json: state.view });
      }
      return route.fulfill({
        status: 500,
        json: { message: 'Unexpected mocked endpoint ' + path },
      });
    }
  );
  const open = async (scenario) => {
    reset(scenario);
    await page.goto('http://127.0.0.1:4321/leitendenbereich/sammelbestellungen/1');
    await page.getByRole('button', { name: 'Bezahlung verwalten', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Bezahlung über CampFlow' })
      .getByText(person.name, { exact: true })
      .waitFor();
  };
  const dialog = () => page.getByRole('dialog', { name: 'Bezahlung über CampFlow' });
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, status: 'PASS' });
    } catch (e) {
      results.push({ name, status: 'FAIL', detail: String(e.message).slice(0, 200) });
    }
  };
  const prepare = async () => {
    await page.getByRole('button', { name: 'Beitrag vorbereiten', exact: true }).click();
    await page
      .getByRole('checkbox', { name: 'Person und endgültiger Betrag sind geprüft.' })
      .check();
  };
  for (const scenario of [
    'ready',
    'missing',
    'unpriced',
    'uncertain',
    'prepared',
    'created',
    'disabled',
    'paid',
    'archived',
    'long',
  ]) {
    await open(scenario);
    await check('layout ' + scenario, async () => {
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
        { width: 320, height: 740 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        if (
          await dialog()
            .locator('.overflow-y-auto')
            .evaluate((el) => el.scrollWidth > el.clientWidth)
        )
          throw new Error('Horizontal overflow ' + viewport.width);
        const footer = dialog().locator('button[type=submit]');
        const b = await footer.boundingBox();
        if (!b || b.y < 0 || b.y + b.height > viewport.height)
          throw new Error('Submit out of viewport ' + viewport.width + 'x' + viewport.height);
      }
    });
    if (scenario === 'uncertain')
      await check('uncertain state copy', async () => {
        if ((await dialog().innerText()).includes('Noch kein Beitrag angelegt'))
          throw new Error('States that no contribution exists despite an uncertain result');
      });
    if (scenario === 'long')
      await page.screenshot({ path: 'output/playwright/issue-89-stress-long-after.png' });
  }
  await open('zero');
  await check('zero amount blocks creation before request', async () => {
    if (!(await dialog().locator('button[type=submit]').isDisabled()))
      throw new Error('0 EUR still offers contribution preparation');
  });
  await open('paid');
  await check('paid orders can adopt an existing contribution without creation', async () => {
    const submit = dialog().locator('button[type=submit]');
    if (await submit.isDisabled()) throw new Error('Paid order blocks manual adoption');
    if ((await submit.innerText()).trim() !== 'Beitrag zuordnen')
      throw new Error('Paid order offers contribution creation');
    await submit.click();
    await page.getByRole('textbox', { name: 'CampFlow-Beitrags-ID', exact: true }).waitFor();
    if (state.posts.includes('create')) throw new Error('Paid order sent a creation request');
  });
  await open('adopt-validation');
  await page.getByRole('button', { name: 'Beitrag zuordnen', exact: true }).click();
  await page.getByRole('textbox', { name: 'CampFlow-Beitrags-ID', exact: true }).fill('fee_Bad');
  await page.getByRole('textbox', { name: 'Zahlungsreferenz', exact: true }).fill('GC12345');
  await page
    .getByRole('textbox', { name: 'Nachweis der Prüfung', exact: true })
    .fill('Meine Prüfung bleibt erhalten.');
  for (const checkbox of await dialog().getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Beitrag zuordnen', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await check('validation retains adoption draft', async () => {
    if (
      (await page.getByRole('textbox', { name: 'Nachweis der Prüfung', exact: true }).count()) !== 1
    )
      throw new Error('Validation closes correction form');
    if (
      (await page
        .getByRole('textbox', { name: 'Nachweis der Prüfung', exact: true })
        .inputValue()) !== 'Meine Prüfung bleibt erhalten.'
    )
      throw new Error('Evidence draft lost');
    if (
      (await dialog()
        .getByRole('textbox', { name: 'CampFlow-Beitrags-ID', exact: true })
        .getAttribute('aria-invalid')) !== 'true'
    )
      throw new Error('No accessible field error');
  });
  await open('dispatch-validation');
  await page.getByRole('button', { name: 'Versand bestätigen', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Die Zahlungsaufforderung wurde' }).check();
  await page.getByRole('button', { name: 'Versand bestätigen', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await check('validation retains dispatch form', async () => {
    if ((await page.getByRole('textbox', { name: 'Versandnachweis', exact: true }).count()) !== 1)
      throw new Error('Validation closes dispatch form');
  });
  await open('lost-success');
  await prepare();
  await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).click();
  await dialog().getByText('GC12345', { exact: true }).waitFor();
  await check('lost success is reconciled without contradictory error', async () => {
    if (await dialog().getByRole('alert').count())
      throw new Error('Error still shown after stored success was loaded');
    if (state.creates !== 1) throw new Error('Repeated external attempt');
  });
  await open('double');
  await prepare();
  await dialog()
    .locator('button[type=submit]')
    .evaluate((el) => {
      el.click();
      el.click();
      el.click();
    });
  await check('busy request locks mode changes and Escape', async () => {
    if (
      !(await page
        .getByRole('button', { name: 'Vorhandenen Beitrag zuordnen', exact: true })
        .isDisabled())
    )
      throw new Error('Mode switch enabled while creating');
    await page.keyboard.press('Escape');
    if ((await dialog().count()) !== 1) throw new Error('Dialog closed during creation');
  });
  releaseCreate();
  await dialog().getByText('GC12345', { exact: true }).waitFor();
  await check('rapid triple click sends one create request', async () => {
    if (state.creates !== 1) throw new Error('Create count ' + state.creates);
  });

  await open('conflict');
  await prepare();
  await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  await check('stale preview must be reviewed again', async () => {
    if (await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).count())
      throw new Error('Old confirmation still available');
    if (state.creates !== 0) throw new Error('Created after a conflict');
  });
  await open('create-uncertain');
  await prepare();
  await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).click();
  await page.getByRole('button', { name: 'Beitrag zuordnen', exact: true }).waitFor();
  await check('uncertain create result permits manual recovery only', async () => {
    if (await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).count())
      throw new Error('Unsafe automatic retry');
    if (state.creates !== 1) throw new Error('Unexpected create count');
  });
  await open('reload-failure');
  await prepare();
  await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  await check('failed reconciliation blocks another create action', async () => {
    if (await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).count())
      throw new Error('Unsafe retry offered');
    if (!(await dialog().innerText()).includes('schließen und neu laden'))
      throw new Error('Missing recovery instructions');
  });
  reset('offline');
  await page.goto('http://127.0.0.1:4321/leitendenbereich/sammelbestellungen/1');
  await page.getByRole('button', { name: 'Bezahlung verwalten', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  await check('unavailable payment data leaves no financial action', async () => {
    if (await page.getByRole('button', { name: 'Beitrag anlegen', exact: true }).count())
      throw new Error('Creation offered without payment state');
  });
  await open('disabled');
  await page.getByRole('button', { name: 'Beitrag vorbereiten', exact: true }).click();
  await page.getByRole('button', { name: 'Beitrag zuordnen', exact: true }).click();
  await page.getByRole('textbox', { name: 'CampFlow-Beitrags-ID', exact: true }).waitFor();
  await check('manual adoption makes no unverified accounting claim', async () => {
    if ((await dialog().innerText()).includes('Kostenstelle'))
      throw new Error('Accounting claimed for manually adopted fee');
    if (state.creates !== 0) throw new Error('Manual adoption creates a remote fee');
  });
  await open('ready');
  await page.setViewportSize({ width: 390, height: 844 });
  await check('keyboard stays in dialog', async () => {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName);
      if (tag === 'BODY') continue;
      if (!(await dialog().evaluate((el) => el.contains(document.activeElement))))
        throw new Error('Focus escapes dialog');
    }
  });
  await page.keyboard.press('Escape');
  await check('Escape restores focus to the opener', async () => {
    if (await dialog().count()) throw new Error('Escape did not close dialog');
    if (
      (await page.evaluate(() => document.activeElement?.textContent?.trim())) !==
      'Bezahlung verwalten'
    )
      throw new Error('Opener focus not restored');
  });
  await page.screenshot({ path: 'output/playwright/issue-89-stress-orders-mobile.png' });
  const failures = results.filter((result) => result.status === 'FAIL');
  if (failures.length) throw new Error(JSON.stringify({ results, failures }));
  return results;
}
