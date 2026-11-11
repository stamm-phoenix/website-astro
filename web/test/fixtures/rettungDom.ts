/**
 * A minimal stand-in for the browser parts `geretteteEingaben.ts` uses: form fields with their
 * labels, a form, `sessionStorage`, `location` and `window` events. Enough to keep and fill in
 * the input of a dialog in `bun test`; layout and focus stay with the browser tests.
 */

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  labels: { textContent: string }[] = [];
  textContent = '';

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

export class FakeInput extends FakeElement {
  type = 'text';
  value = '';
  checked = false;
}

export class FakeTextArea extends FakeElement {
  value = '';
}

export class FakeOption {
  selected = false;
  constructor(readonly value: string) {}
}

export class FakeSelect extends FakeElement {
  options: FakeOption[] = [];
  get selectedOptions(): FakeOption[] {
    return this.options.filter((option) => option.selected);
  }
}

export class FakeForm extends EventTarget {
  elements: FakeElement[] = [];
}

type Field = FakeInput | FakeTextArea | FakeSelect;

interface FieldOptions {
  type?: string;
  value?: string;
  checked?: boolean;
  /** Named by a `<label>` instead of `aria-label`. */
  label?: boolean;
}

function named<T extends FakeElement>(field: T, label: string, byLabel = false): T {
  if (byLabel) field.labels = [{ textContent: ` ${label}\n` }];
  else field.attributes.set('aria-label', label);
  return field;
}

export function input(label: string, options: FieldOptions = {}): FakeInput {
  const field = named(new FakeInput(), label, options.label);
  field.type = options.type ?? 'text';
  field.value = options.value ?? '';
  field.checked = options.checked ?? false;
  return field;
}

export function textarea(label: string, value = ''): FakeTextArea {
  const field = named(new FakeTextArea(), label);
  field.value = value;
  return field;
}

export function select(label: string, values: string[], chosen: string[] = []): FakeSelect {
  const field = named(new FakeSelect(), label);
  field.options = values.map((value) => new FakeOption(value));
  for (const option of field.options) option.selected = chosen.includes(option.value);
  return field;
}

export function form(...fields: Field[]): HTMLFormElement & FakeForm {
  const result = new FakeForm();
  result.elements = fields;
  return result as unknown as HTMLFormElement & FakeForm;
}

/** The fields of `target` as the stand-ins they are. */
export function fieldsOf(target: HTMLFormElement): Field[] {
  return (target as unknown as FakeForm).elements as Field[];
}

/** Renders `target` again with `fields`, like a list that gained or lost rows. */
export function setFields(target: HTMLFormElement, fields: Field[]): void {
  (target as unknown as FakeForm).elements = fields;
}

/** Adds the options of a list that arrived late, e.g. the Aktionen from CampFlow. */
export function addOptions(field: FakeSelect, values: string[]): void {
  field.options.push(...values.map((value) => new FakeOption(value)));
}

class FakeStorage {
  readonly entries = new Map<string, string>();
  failing = false;
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failing) throw new DOMException('full', 'QuotaExceededError');
    this.entries.set(key, value);
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

export const storage = new FakeStorage();
const page = { pathname: '/leitendenbereich/gruppenstunden', search: '', hash: '' };
export const windowEvents = new EventTarget();

const FAKES: Record<string, unknown> = {
  HTMLInputElement: FakeInput,
  HTMLTextAreaElement: FakeTextArea,
  HTMLSelectElement: FakeSelect,
  HTMLFormElement: FakeForm,
  sessionStorage: storage,
  location: page,
  window: windowEvents,
  document: { getElementById: () => null },
};

/**
 * Puts the stand-ins on `globalThis` and returns the function that removes them again, so other
 * test files in the same run still see no browser. Call it in `before` and the result in `after`.
 */
export function installDom(): () => void {
  const globals = globalThis as Record<string, unknown>;
  const previous = Object.keys(FAKES).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globals, name)] as const
  );
  for (const [name, value] of Object.entries(FAKES)) {
    Object.defineProperty(globals, name, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globals, name, descriptor);
      else delete globals[name];
    }
  };
}

/** Opens `path` (with its query) in the same tab, which keeps `sessionStorage`. */
export function visit(path: string, search = ''): void {
  page.pathname = path;
  page.search = search;
}

/** A new tab or a test of its own: nothing kept, storage works. */
export function reset(path = '/leitendenbereich/gruppenstunden'): void {
  storage.entries.clear();
  storage.failing = false;
  visit(path);
}

/** Records each `input`/`change` event a field gets, in order. */
export function events(...fields: EventTarget[]): string[] {
  const seen: string[] = [];
  for (const [index, field] of fields.entries()) {
    for (const type of ['input', 'change'])
      field.addEventListener(type, () => seen.push(`${index}:${type}`));
  }
  return seen;
}
