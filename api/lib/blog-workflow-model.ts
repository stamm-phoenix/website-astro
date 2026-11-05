/** Shared workflow DTO, without browser dependencies. */
export interface BlogWorkflowEvent {
  at: string;
  by: string;
  name: string;
}
export interface BlogWorkflow {
  state: 'draft' | 'review' | 'approved' | 'published';
  submitted?: BlogWorkflowEvent;
  reviewed?: BlogWorkflowEvent;
  publication?: BlogWorkflowEvent;
  withdrawn?: BlogWorkflowEvent;
  feedback?: string;
}
