/** Browser-safe DTOs for the shared tasks module. */
export interface TaskInput {
  title: string;
  description: string;
  assignee: string;
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
