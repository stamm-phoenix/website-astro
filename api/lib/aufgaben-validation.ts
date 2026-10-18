import { taskPeople } from './aufgaben-zuordnung';
import { projectTitle } from './aufgaben-projekte';
import { isValidDate, ValidationError } from './pflege-validation';
import type { TaskInput, TemplateItem, TaskPerson } from './aufgaben-model';

/** Require a JSON object before reading form fields. */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError({ form: 'Bitte die Felder ausfüllen.' });
  return value as Record<string, unknown>;
}
/** Trim and validate a bounded text field, allowing empty optional values. */
export function taskText(value: unknown, field: string, max: number, required = false): string {
  if (value !== undefined && typeof value !== 'string')
    throw new ValidationError({ [field]: 'Bitte Text angeben.' });
  const text = typeof value === 'string' ? value.trim() : '';
  if ((required && !text) || text.length > max)
    throw new ValidationError({
      [field]: `Bitte ${required ? '1 bis ' : 'höchstens '}${max} Zeichen angeben.`,
    });
  return text;
}
/** Validate a calendar date supported by SQL, or normalize an optional empty date to null. */
export function taskDate(value: unknown, required = false): string | null {
  if (!required && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !isValidDate(value) || value.startsWith('0000-'))
    throw new ValidationError({ dueDate: 'Bitte ein gültiges Datum angeben.' });
  return value;
}
/** Require a positive integer reference; numeric strings are not accepted. */
export function taskId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 999999999)
    throw new ValidationError({ [field]: 'Bitte einen gültigen Eintrag auswählen.' });
  return value;
}
/** A project name, empty for „Ohne Projekt“; whitespace is collapsed. */
export function taskProject(value: unknown, field = 'project', required = false): string {
  return projectTitle(taskText(value, field, 200, required));
}
/** Bound multi-person assignments and reject malformed identities before writing JSON. */
function people(value: unknown): TaskPerson[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new ValidationError({ assignee: 'Bitte höchstens 20 Personen auswählen.' });
  const assignees = value.map((entry) => {
    const person = object(entry);
    const name = taskText(person.name, 'assignee', 200, true);
    const login = taskText(person.login, 'assignee', 254);
    if (login && !/^[^\s@]+@[^\s@]+$/.test(login))
      throw new ValidationError({ assignee: 'Bitte einen gültigen Login auswählen.' });
    return { name, login };
  });
  return taskPeople({ assignee: '', assignees });
}
/** Validate editable task fields, excluding state and source metadata. */
export function validateTask(value: unknown): TaskInput {
  const body = object(value);
  return {
    title: taskText(body.title, 'title', 200, true),
    description: taskText(body.description, 'description', 2000),
    assignee: taskText(body.assignee, 'assignee', 254),
    ...(body.assignees !== undefined ? { assignees: people(body.assignees) } : {}),
    dueDate: taskDate(body.dueDate),
    ...(body.project !== undefined ? { project: taskProject(body.project) } : {}),
  };
}
/** Validate up to 50 checklist items with integer offsets of at most one year. */
export function validateTemplate(value: unknown): { title: string; items: TemplateItem[] } {
  const body = object(value);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50)
    throw new ValidationError({ items: 'Bitte 1 bis 50 Aufgaben angeben.' });
  return {
    title: taskText(body.title, 'title', 200, true),
    items: body.items.map((value) => {
      const item = object(value);
      if (
        typeof item.daysBefore !== 'number' ||
        !Number.isInteger(item.daysBefore) ||
        Math.abs(item.daysBefore) > 366
      )
        throw new ValidationError({
          items: 'Der Abstand zum Aktionsdatum muss zwischen −366 und 366 Tagen liegen.',
        });
      return {
        title: taskText(item.title, 'title', 200, true),
        description: taskText(item.description, 'description', 2000),
        assignee: taskText(item.assignee, 'assignee', 254),
        ...(item.assignees !== undefined ? { assignees: people(item.assignees) } : {}),
        daysBefore: item.daysBefore,
      };
    }),
  };
}
