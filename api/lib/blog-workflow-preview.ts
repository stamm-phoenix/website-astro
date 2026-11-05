import { getDb } from './db';
/** Only invented preview fixtures passed by the preview seeder. */
export async function seedBlogWorkflow(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await getDb()
    .updateTable('content.blog_post')
    .set({ published: true, workflow_json: JSON.stringify({ state: 'published' }) })
    .where('id', 'in', ids)
    .where('updated_by', '=', 'preview')
    .where((eb) =>
      eb.or([
        eb('workflow_json', 'is', null),
        eb('workflow_json', '=', JSON.stringify({ state: 'draft' })),
      ])
    )
    .execute();
}
