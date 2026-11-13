import { z } from 'zod';
import {
  inTransaction,
  lockResource,
  parseId,
  RecordNotFoundError,
  toVersion,
  VersionConflictError,
  requireRowversion,
} from './db';
import { readBlogWorkflow } from './blog-workflow-read';
import type { BlogWorkflow } from './blog-workflow-model';
import type { ClientPrincipal } from './staff-auth';
import { parseWith, lenientObject } from './validation/zod';
import { nextBlogWorkflow } from './blog-workflow-policy';
export { nextBlogWorkflow } from './blog-workflow-policy';

const schema = lenientObject({
  action: z.enum(['submit', 'return', 'approve', 'publish', 'unpublish'], {
    error: 'Bitte eine gültige Aktion wählen.',
  }),
  etag: z
    .string({ error: 'Bitte den aktuellen Beitrag neu laden.' })
    .min(1, { error: 'Bitte den aktuellen Beitrag neu laden.' }),
  feedback: z
    .string({ error: 'Bitte eine Rückmeldung eingeben.' })
    .trim()
    .max(2000, { error: 'Die Rückmeldung darf höchstens 2000 Zeichen haben.' })
    .optional(),
});

export async function transitionBlog(
  id: string,
  body: unknown,
  actor: ClientPrincipal
): Promise<{ etag: string; workflow: BlogWorkflow }> {
  const input = parseWith(schema, body);
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  return inTransaction(async (trx) => {
    await lockResource(trx, `blog-workflow:${id}`);
    const row = await trx
      .selectFrom('content.blog_post')
      .selectAll()
      .where('id', '=', numericId)
      .executeTakeFirst();
    if (!row) throw new RecordNotFoundError();
    const version = requireRowversion(input.etag);
    if (!row.version.equals(version)) throw new VersionConflictError();
    const workflow = nextBlogWorkflow(
      readBlogWorkflow(row.workflow_json, row.published),
      input.action,
      actor,
      row.updated_by,
      input.feedback
    );
    const changed = await trx
      .updateTable('content.blog_post')
      .set({ workflow_json: JSON.stringify(workflow), published: workflow.state === 'published' })
      .where('id', '=', numericId)
      .where('version', '=', version)
      .output('inserted.version')
      .executeTakeFirst();
    if (!changed) throw new VersionConflictError();
    return { etag: toVersion(changed.version), workflow };
  });
}
