import { getDb } from './db';

/**
 * Invented Problemmeldungen in every state of the hand-over: open with a usable assessment,
 * open with a failed one, recognized as spam, discarded and sent to GitHub. Each one is skipped
 * if it exists already. The preview never sends to GitHub (`github-issues.ts`).
 */
export async function seedPreviewProblemmeldungen(now: Date = new Date()): Promise<void> {
  const db = getDb();
  const hoursAgo = (hours: number): string =>
    new Date(now.getTime() - hours * 3_600_000).toISOString();
  const context = {
    page: '/leitendenbereich/belege',
    module: 'Belege',
    error_code: 'INTERNAL',
    http_status: 500,
    action: '/api/intern/pflege/belege',
    app_version: 'abc1234',
    browser: 'Firefox 133 · Linux',
    viewport: '390x844',
  };
  const reports = [
    {
      description:
        'Beim Hochladen eines Belegfotos kommt eine Fehlermeldung und der Beleg ist danach weg. (Testdaten der Preview)',
      steps: '1. Belege öffnen\n2. Foto auswählen\n3. „Beleg einreichen“ tippen',
      expected: 'Der Beleg wird eingereicht.',
      entry: 'fehler' as const,
      ...context,
      ai_status: 'fertig' as const,
      ai_verdict: 'plausibel' as const,
      ai_reason: 'Konkrete Schritte und ein Fehlercode der Schnittstelle liegen vor.',
      ai_at: hoursAgo(5),
      draft_title: 'Belege: Hochladen eines Fotos endet mit einem Serverfehler',
      draft_body:
        '## Zusammenfassung\n\nBeim Einreichen eines Belegs mit Foto erscheint eine Fehlermeldung.\n\n## Schritte zur Reproduktion\n\n1. Belege öffnen\n2. Foto auswählen\n3. „Beleg einreichen“ tippen\n\n## Erwartetes Verhalten\n\nDer Beleg wird eingereicht.\n\n## Tatsächliches Verhalten\n\nEs erscheint eine Fehlermeldung (HTTP 500).',
      created_at: hoursAgo(6),
    },
    {
      description:
        'Auf dem Handy ist die Startseite des Leitendenbereichs abgeschnitten. (Testdaten der Preview)',
      entry: 'footer' as const,
      page: '/leitendenbereich',
      browser: 'Safari 18 · iOS 18',
      viewport: '375x667',
      ai_status: 'fehler' as const,
      ai_error: 'Azure OpenAI request timed out',
      created_at: hoursAgo(3),
    },
    {
      description: 'Günstige Uhren kaufen!!! Jetzt klicken. (Testdaten der Preview)',
      entry: 'footer' as const,
      ai_status: 'fertig' as const,
      ai_verdict: 'spam' as const,
      ai_reason: 'Werbung ohne Bezug zur Website.',
      ai_at: hoursAgo(2),
      draft_title: 'Werbung',
      draft_body: '## Zusammenfassung\n\nWerbetext.',
      created_at: hoursAgo(2),
    },
    {
      description: 'Der Kalender zeigt das Zeltlager am falschen Tag. (Testdaten der Preview)',
      entry: 'footer' as const,
      page: '/aktionen',
      status: 'verworfen' as const,
      ai_status: 'fertig' as const,
      ai_verdict: 'unklar' as const,
      ai_reason: 'Es fehlt, welches Zeltlager und welcher Tag gemeint ist.',
      ai_at: hoursAgo(30),
      reviewed_by: 'vorschau@example.test',
      reviewed_at: hoursAgo(28),
      discard_reason: 'Stimmte schon; Datum in CampFlow war nur kurz falsch.',
      created_at: hoursAgo(31),
    },
    {
      description:
        'Der Link „Gruppenstunden“ im Footer führt auf eine leere Seite. (Testdaten der Preview)',
      entry: 'footer' as const,
      page: '/',
      status: 'uebermittelt' as const,
      ai_status: 'fertig' as const,
      ai_verdict: 'plausibel' as const,
      ai_reason: 'Nachvollziehbar und konkret.',
      ai_at: hoursAgo(50),
      draft_title: 'Footer: Link zu den Gruppenstunden führt auf eine leere Seite',
      draft_body:
        '## Zusammenfassung\n\nDer Footer-Link zu den Gruppenstunden zeigt eine leere Seite.',
      github_label: 'bug' as const,
      reviewed_by: 'vorschau@example.test',
      reviewed_at: hoursAgo(48),
      github_started_at: hoursAgo(48),
      github_number: 270,
      github_url: 'https://github.com/stamm-phoenix/website-astro/issues/270',
      github_at: hoursAgo(48),
      created_at: hoursAgo(52),
    },
  ];
  for (const report of reports) {
    const exists = await db
      .selectFrom('problem.meldung')
      .select('id')
      .where('description', '=', report.description)
      .executeTakeFirst();
    if (exists) continue;
    await db
      .insertInto('problem.meldung')
      .values({
        environment: 'vorschau',
        http_status: null,
        ai_verdict: null,
        ai_started_at: null,
        ai_at: null,
        reviewed_at: null,
        github_started_at: null,
        github_first_at: null,
        github_number: null,
        github_at: null,
        ...report,
        created_at: new Date(report.created_at),
      })
      .execute();
  }
}
