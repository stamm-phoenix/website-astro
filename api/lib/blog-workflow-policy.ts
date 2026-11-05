import type { BlogWorkflow } from './blog-workflow-model';
interface WorkflowActor {
  userId: string;
  userDetails: string;
}
import { ValidationError } from './validation/errors';
export function nextBlogWorkflow(
  current: BlogWorkflow,
  action: 'submit' | 'return' | 'approve' | 'publish' | 'unpublish',
  actor: WorkflowActor,
  lastEditor: string,
  feedback?: string
): BlogWorkflow {
  const event = { at: new Date().toISOString(), by: actor.userId, name: actor.userDetails };
  const invalid = (message: string): never => {
    throw new ValidationError({ action: message });
  };
  if (action === 'submit' && current.state === 'draft')
    return { state: 'review', submitted: event };
  if ((action === 'approve' || action === 'return') && current.state === 'review') {
    if (
      current.submitted?.by === actor.userId ||
      lastEditor.toLowerCase() === actor.userDetails.toLowerCase()
    )
      invalid('Eine andere Person muss den Beitrag prüfen.');
    if (action === 'return') {
      if (!feedback) invalid('Bitte eine Rückmeldung eingeben.');
      return { ...current, state: 'draft', reviewed: event, feedback };
    }
    return { ...current, state: 'approved', reviewed: event, feedback: undefined };
  }
  if (action === 'publish' && current.state === 'approved')
    return { ...current, state: 'published', publication: event };
  if (action === 'unpublish' && current.state === 'published') return { state: 'draft' };
  return invalid('Diese Aktion ist für den aktuellen Stand nicht möglich. Bitte neu laden.');
}
