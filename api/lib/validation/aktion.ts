import { z } from 'zod';
import { isValidDate } from '../calendar-date';
import { CAMPFLOW_EVENT_ID_PATTERN } from '../campflow';
import { sanitize } from './rich-text';
import { choices, isRecord, labeledText, lenientObject, parseWith } from './zod';

const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_MEETING_POINT_LENGTH = 500;
const MAX_PACKING_ITEM_LENGTH = 255;
const MAX_PACKING_ITEMS = 200;
const MAX_DOWNLOAD_IDS = 100;
const HTTPS_URL = /^https:\/\/[^\s"'<>`]+$/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface AktionInput {
  campflowId: string | null;
  stufen: string[];
  description: string;
  title: string;
  start: string;
  end: string;
  link: string;
  meetingPoint?: string;
  packingList?: string[];
  downloadIds?: string[];
}

const descriptionSchema = z
  .unknown()
  .optional()
  .transform((raw, ctx) => {
    const sanitized = sanitize(text(raw));
    if (sanitized.textLength > MAX_DESCRIPTION_LENGTH) {
      ctx.issues.push({
        code: 'custom',
        input: raw,
        message: `Die Beschreibung darf höchstens ${MAX_DESCRIPTION_LENGTH} Zeichen lang sein.`,
      });
    }
    return sanitized.html;
  });

const campflowIdSchema = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string' && CAMPFLOW_EVENT_ID_PATTERN.test(value)) return value;
    ctx.issues.push({ code: 'custom', input: value, message: 'Die CampFlow-Aktion ist ungültig.' });
    return null;
  });

const packingListSchema = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      ctx.issues.push({ code: 'custom', input: value, message: 'Die Packliste ist ungültig.' });
      return [];
    }
    const items = value.map((item) => (typeof item === 'string' ? item.trim() : item));
    if (items.some((item) => typeof item !== 'string')) {
      ctx.issues.push({ code: 'custom', input: value, message: 'Die Packliste ist ungültig.' });
      return [];
    }
    if (items.length > MAX_PACKING_ITEMS) {
      ctx.issues.push({
        code: 'custom',
        input: value,
        message: `Die Packliste darf höchstens ${MAX_PACKING_ITEMS} Einträge enthalten.`,
      });
    }
    if (items.some((item) => item.length > MAX_PACKING_ITEM_LENGTH)) {
      ctx.issues.push({
        code: 'custom',
        input: value,
        message: `Ein Packlisteneintrag darf höchstens ${MAX_PACKING_ITEM_LENGTH} Zeichen lang sein.`,
      });
    }
    return [...new Set(items.filter((item) => item.length > 0))] as string[];
  });

const downloadIdsSchema = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
      ctx.issues.push({ code: 'custom', input: value, message: 'Die Unterlagen sind ungültig.' });
      return [];
    }
    const ids = value.map((id) => id.trim());
    if (ids.some((id) => !/^[A-Za-z0-9!_-]{1,64}$/.test(id))) {
      ctx.issues.push({ code: 'custom', input: value, message: 'Die Unterlagen sind ungültig.' });
      return [];
    }
    if (ids.length > MAX_DOWNLOAD_IDS) {
      ctx.issues.push({
        code: 'custom',
        input: value,
        message: `Es dürfen höchstens ${MAX_DOWNLOAD_IDS} Unterlagen verknüpft werden.`,
      });
    }
    return [...new Set(ids)];
  });

function aktionShape(stufen: string[]) {
  return {
    campflowId: campflowIdSchema,
    stufen: choices('Die Auswahl der Stufen', stufen).refine((selected) => selected.length > 0, {
      error: 'Bitte mindestens eine Stufe auswählen.',
    }),
    description: descriptionSchema,
    meetingPoint: labeledText('den Treffpunkt', MAX_MEETING_POINT_LENGTH),
    packingList: packingListSchema,
    downloadIds: downloadIdsSchema,
  };
}

const FROM_CAMPFLOW = { title: '', start: '', end: '', link: '' };

function dateText(label: string, required: boolean, invalid: string) {
  return labeledText(label, Infinity, required).refine((value) => !value || isValidDate(value), {
    error: invalid,
  });
}

function freeAktionSchema(stufen: string[]) {
  return lenientObject({
    ...aktionShape(stufen),
    title: labeledText('einen Titel', 255, true),
    start: dateText('ein Startdatum', true, 'Bitte ein gültiges Startdatum angeben.'),
    end: dateText('das Enddatum', false, 'Bitte ein gültiges Enddatum angeben.'),
    link: labeledText('Der Anmeldelink', Infinity)
      .refine((value) => !value || HTTPS_URL.test(value), {
        error: 'Der Anmeldelink muss mit https:// beginnen.',
      })
      .refine((value) => value.length <= 255, {
        error: 'Der Anmeldelink darf höchstens 255 Zeichen lang sein.',
      }),
  })
    .refine(({ start, end }) => !(text(end) && text(start) && text(end) < text(start)), {
      path: ['end'],
      error: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      when: () => true,
    })
    .transform((input) => ({ ...input, end: input.end || input.start }));
}

function linkedAktionSchema(stufen: string[]) {
  return lenientObject(aktionShape(stufen)).transform((input) => ({ ...input, ...FROM_CAMPFLOW }));
}

export function validateAktion(body: unknown, stufen: string[]): AktionInput {
  const id = isRecord(body) ? body.campflowId : undefined;
  const linked = typeof id === 'string' && CAMPFLOW_EVENT_ID_PATTERN.test(id);
  const input = parseWith(linked ? linkedAktionSchema(stufen) : freeAktionSchema(stufen), body);
  const { meetingPoint, packingList, downloadIds, ...base } = input;
  return {
    ...base,
    ...(meetingPoint ? { meetingPoint } : {}),
    ...(packingList?.length ? { packingList } : {}),
    ...(downloadIds?.length ? { downloadIds } : {}),
  };
}
