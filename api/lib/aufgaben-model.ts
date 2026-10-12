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
  projectId: number | null;
}
export interface Task extends TaskInput {
  id: number;
  etag: string;
  state: 'offen' | 'erledigt' | 'vorschlag' | 'abgelehnt';
  sourceId: string;
  sourceVersion: string;
  quote: string;
}
export interface TaskProject {
  id: number;
  etag: string;
  title: string;
  campflowId: string;
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
  projects: TaskProject[];
  templates: TaskTemplate[];
  login: string;
  /** Review permission from the principal, independent of SharePoint availability. */
  reviewer: boolean;
  extractionConfigured: boolean;
}
export interface TaskAssignment {
  assignee: string | null;
  unavailable: boolean;
}
