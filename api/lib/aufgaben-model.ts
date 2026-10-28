/** Browser-safe DTOs for the shared tasks module. The input types are inferred from their zod schemas. */
import type { TaskInput, TaskPerson, TemplateItem } from './aufgaben-schema';

export type { TaskInput, TaskPerson, TemplateItem };
export interface Task extends TaskInput {
  id: number;
  etag: string;
  state: 'offen' | 'erledigt' | 'vorschlag' | 'abgelehnt';
  sourceId: string;
  sourceVersion: string;
  quote: string;
  suggestedProjectTitle?: string;
  suggestedAssigneeName?: string;
  assignmentResolution?: 'legacy' | 'matched' | 'declined';
  /** Minutes of the editor whose approval created the task, with the item („3. Planung“). */
  protokollId?: number | null;
  protokollPunkt?: string;
}
export interface TaskProject {
  id: number;
  etag: string;
  title: string;
  campflowId: string;
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
  extractionConfigured: boolean;
}
export interface TaskAssignment {
  assignee: string | null;
  unavailable: boolean;
}
