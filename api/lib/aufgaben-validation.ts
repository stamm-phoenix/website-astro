import { z } from 'zod';
import { taskPeople } from './aufgaben-zuordnung';
import {
  boundedText,
  optionalTaskDateSchema,
  taskDateSchema,
  taskIdSchema,
  taskInputSchema,
  taskTemplateInputSchema,
} from './aufgaben-schema';
import type { TaskInput, TemplateItem } from './aufgaben-schema';
import { parseWith } from './validation/zod';
import type { FieldOf } from './validation/zod';

/** Name the person once per identity before writing JSON. */
function dedupePeople<T extends Pick<TaskInput, 'assignees'>>(entry: T): T {
  return entry.assignees
    ? { ...entry, assignees: taskPeople({ assignee: '', assignees: entry.assignees }) }
    : entry;
}

const taskSchema = taskInputSchema.transform(dedupePeople);
const templateSchema = taskTemplateInputSchema.transform((template) => ({
  ...template,
  items: template.items.map(dedupePeople),
}));

/** Errors of the people picker show at the assignee field. */
const taskField: FieldOf = ([first]) => {
  if (first === 'assignees') return 'assignee';
  return typeof first === 'string' ? first : 'form';
};
/** Errors of a checklist item show at its own field, the offset and the list itself at `items`. */
const templateField: FieldOf = (path) => {
  const [first, , field] = path;
  if (first !== 'items') return taskField(path);
  if (field === 'assignees') return 'assignee';
  return typeof field === 'string' && field !== 'daysBefore' ? field : 'items';
};

/** Trim and validate a bounded text field, allowing empty optional values. */
export function taskText(value: unknown, field: string, max: number, required = false): string {
  const row = parseWith(z.object({ [field]: boundedText(max, required) }), { [field]: value });
  return row[field];
}
/** Validate a calendar date supported by SQL, or normalize an optional empty date to null. */
export function taskDate(value: unknown, required = false): string | null {
  const dueDate = required ? taskDateSchema : optionalTaskDateSchema;
  return parseWith(z.object({ dueDate }), { dueDate: value }).dueDate;
}
/** Require a positive integer reference; numeric strings are not accepted. */
export function taskId(value: unknown, field = 'projectId'): number {
  return parseWith(z.object({ [field]: taskIdSchema }), { [field]: value })[field];
}
/** Validate editable task fields, excluding state and source metadata. */
export function validateTask(value: unknown): TaskInput {
  return parseWith(taskSchema, value, taskField);
}
/** Validate up to 50 checklist items with integer offsets of at most one year. */
export function validateTemplate(value: unknown): { title: string; items: TemplateItem[] } {
  return parseWith(templateSchema, value, templateField);
}
