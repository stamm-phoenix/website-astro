import { z } from 'zod';
import type { BlogWorkflow } from './blog-workflow-model';
const event = z.object({ at: z.string(), by: z.string(), name: z.string() });
const schema = z.object({
  state: z.enum(['draft', 'review', 'approved', 'published']),
  submitted: event.optional(),
  reviewed: event.optional(),
  publication: event.optional(),
  withdrawn: event.optional(),
  feedback: z.string().optional(),
});
/** Lenient on old rows, closed on malformed workflow data. */
export function readBlogWorkflow(raw: string | null, published: boolean): BlogWorkflow {
  if (!raw) return { state: published ? 'published' : 'draft' };
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : { state: 'draft' };
  } catch {
    return { state: 'draft' };
  }
}
