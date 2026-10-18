/** Browser-safe DTOs for the shared tasks module. */
export interface TaskPerson {
  name: string;
  login: string;
}
export interface TaskInput {
  title: string;
  description: string;
  assignee: string;
  assignees?: TaskPerson[];
  dueDate: string | null;
  /** Project name; older clients omit it, which keeps the stored project. */
  project?: string;
}
export interface Task extends TaskInput {
  project: string;
  id: number;
  etag: string;
  state: 'offen' | 'erledigt' | 'vorschlag' | 'abgelehnt';
  sourceId: string;
  sourceVersion: string;
  quote: string;
  suggestedProjectTitle?: string;
  suggestedAssigneeName?: string;
  assignmentResolution?: 'legacy' | 'matched' | 'declined';
}
/** Derived from the tasks (`taskProjects`), not stored on its own. */
export interface TaskProject {
  title: string;
  open: number;
  done: number;
}
export interface TemplateItem {
  title: string;
  description: string;
  assignee: string;
  assignees?: TaskPerson[];
  daysBefore: number;
}
export interface TaskTemplate {
  id: number;
  etag: string;
  title: string;
  items: TemplateItem[];
}
export interface TasksOverview {
  tasks: Task[];
  templates: TaskTemplate[];
  login: string;
  extractionConfigured: boolean;
}
export interface TaskAssignment {
  assignee: string | null;
  unavailable: boolean;
}
