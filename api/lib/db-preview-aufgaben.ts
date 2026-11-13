import { lockResource } from './db';
import { inTransaction } from './db';
const PREVIEW_ACTOR = 'preview';

/** Invented tasks data, including a source proposal; fills each missing part on retries. */
export async function seedPreviewTasks(): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, 'preview:tasks');
    // Titles are editable; remember seeded rows independently of their current content.
    const stateKey = 'preview:tasks:ids:1';
    const registry = await trx
      .selectFrom('nikolaus.state')
      .select('value')
      .where('state_key', '=', stateKey)
      .executeTakeFirst();
    const ids: Record<string, number> = {};
    if (registry) {
      const stored: unknown = JSON.parse(registry.value);
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
          if (typeof value === 'number' && Number.isInteger(value) && value > 0) ids[key] = value;
        }
      }
    }
    for (const [table, names] of [
      ['organisation.project', ['Herbstaktion']],
      ['organisation.template', ['Aktionsvorbereitung']],
      [
        'organisation.task',
        [
          'Material prüfen',
          'Treffpunkt bestätigt',
          'Lagerküche planen',
          'Material für Winteraktion vorbereiten',
        ],
      ],
    ] as const) {
      for (const title of names)
        await trx
          .updateTable(table)
          .set({ title })
          .where('title', '=', `Preview: ${title}`)
          .where('updated_by', '=', PREVIEW_ACTOR)
          .execute();
    }
    let project = await trx
      .selectFrom('organisation.project')
      .select('id')
      .where((eb) => (ids.project ? eb('id', '=', ids.project) : eb('title', '=', 'Herbstaktion')))
      .executeTakeFirst();
    if (!project)
      project = await trx
        .insertInto('organisation.project')
        .values({ title: 'Herbstaktion', campflow_id: '', updated_by: PREVIEW_ACTOR })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
    ids.project = project.id;
    let template = await trx
      .selectFrom('organisation.template')
      .select('id')
      .where((eb) =>
        ids.template ? eb('id', '=', ids.template) : eb('title', '=', 'Aktionsvorbereitung')
      )
      .executeTakeFirst();
    if (!template)
      template = await trx
        .insertInto('organisation.template')
        .values({
          title: 'Aktionsvorbereitung',
          updated_by: PREVIEW_ACTOR,
          items: JSON.stringify([
            {
              title: 'Material prüfen',
              description: 'Zelte und Spiele durchsehen.',
              assignee: '',
              daysBefore: 7,
            },
          ]),
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
    ids.template = template.id;
    const checklist = await trx
      .selectFrom('organisation.checklist')
      .select('project_id')
      .where('project_id', '=', project.id)
      .where('template_id', '=', template.id)
      .executeTakeFirst();
    if (!checklist)
      await trx
        .insertInto('organisation.checklist')
        .values({ project_id: project.id, template_id: template.id })
        .execute();
    for (const entry of [
      {
        key: 'material',
        title: 'Material prüfen',
        state: 'offen' as const,
        quote: '',
        source_id: '',
        source_version: '',
      },
      {
        key: 'treffpunkt',
        title: 'Treffpunkt bestätigt',
        state: 'erledigt' as const,
        quote: '',
        source_id: '',
        source_version: '',
      },
      {
        key: 'lagerkueche',
        title: 'Lagerküche planen',
        state: 'vorschlag' as const,
        quote: 'Alex plant die Lagerküche.',
        source_id: 'preview-protokoll',
        source_version: 'preview-only',
      },
      {
        key: 'projektidee',
        title: 'Material für Winteraktion vorbereiten',
        state: 'vorschlag' as const,
        quote: 'Alex bereitet Material für die Winteraktion vor.',
        source_id: 'preview-projektidee',
        source_version: 'preview-only',
        suggested_project_title: 'Winteraktion',
      },
    ]) {
      const { key, ...values } = entry;
      let existing = await trx
        .selectFrom('organisation.task')
        .select('id')
        .where((eb) => (ids[key] ? eb('id', '=', ids[key]) : eb('title', '=', entry.title)))
        .executeTakeFirst();
      if (!existing)
        existing = await trx
          .insertInto('organisation.task')
          .values({
            ...values,
            project_id: key === 'projektidee' ? null : project.id,
            description:
              key === 'material'
                ? 'Zelte und Spiele für die Herbstaktion durchsehen.'
                : key === 'treffpunkt'
                  ? 'Treffpunkt für die Aktion ist abgestimmt.'
                  : 'Vorbereitung für die nächste gemeinsame Aktion.',
            assignee: 'alex@example.test',
            assignees: JSON.stringify(
              values.state === 'offen'
                ? [
                    { name: 'Alex Beispiel', login: 'alex@example.test' },
                    { name: 'Bea Beispiel', login: 'bea@example.test' },
                  ]
                : [{ name: 'Alex Beispiel', login: 'alex@example.test' }]
            ),
            due_date: '2026-11-01',
            updated_by: PREVIEW_ACTOR,
          })
          .output('inserted.id')
          .executeTakeFirstOrThrow();
      ids[key] = existing.id;
    }
    const recognition = await trx
      .selectFrom('organisation.task_recognition')
      .select('source_id')
      .where('source_id', '=', 'preview-projektidee')
      .where('source_version', '=', 'preview-only')
      .executeTakeFirst();
    if (!recognition)
      await trx
        .insertInto('organisation.task_recognition')
        .values({ source_id: 'preview-projektidee', source_version: 'preview-only' })
        .execute();
    const reminder = await trx
      .selectFrom('organisation.task_reminder_delivery')
      .select('id')
      .where('reminder_day', '=', '2026-10-12')
      .where('recipient', '=', 'alex@example.test')
      .executeTakeFirst();
    if (!reminder)
      await trx
        .insertInto('organisation.task_reminder_delivery')
        .values({
          reminder_day: '2026-10-12',
          recipient: 'alex@example.test',
          status: 'sent',
          sent_at: new Date('2026-10-12T07:17:00Z'),
        })
        .execute();
    const rundeReminder = await trx
      .selectFrom('protokoll.erinnerung')
      .select('id')
      .where('meeting_key', '=', '2026-10-14T19:00')
      .where('days_before', '=', 7)
      .executeTakeFirst();
    if (!rundeReminder)
      await trx
        .insertInto('protokoll.erinnerung')
        .values({
          meeting_key: '2026-10-14T19:00',
          meeting_date: '2026-10-14',
          meeting_at: new Date('2026-10-14T17:00:00Z'),
          protokoll_ref: 'editor:0',
          days_before: 7,
          recipient_hash: 'a'.repeat(64),
          status: 'sent',
          sent_at: new Date('2026-10-07T07:47:00Z'),
        })
        .execute();
    if (registry) {
      await trx
        .updateTable('nikolaus.state')
        .set({ value: JSON.stringify(ids) })
        .where('state_key', '=', stateKey)
        .execute();
    } else {
      await trx
        .insertInto('nikolaus.state')
        .values({ state_key: stateKey, value: JSON.stringify(ids) })
        .execute();
    }
  });
}
