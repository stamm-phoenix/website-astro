import {
  POSTFAECHER,
  findPostfach,
  postfachRoles,
  type PostfachEintrag,
} from '../../../api/lib/postfach-liste';
import type { StaffModule } from './staffModuleTypes';

/** Envelope, 24×24 stroke. */
const ICON = 'M3 6h18v12H3zM3 7l9 6 9-6';

/** The page of the module „Postfächer“; the chosen mailbox sits in `?postfach=`. */
export const POSTFACH_PATH = '/leitendenbereich/email';

/** Path of the page with a mailbox chosen. */
export function postfachHref(id: string): string {
  return `${POSTFACH_PATH}?postfach=${encodeURIComponent(id)}`;
}

/** Name of a mailbox in the choice on the page, without „-Postfach“. */
export function postfachKurzname(postfach: Pick<PostfachEintrag, 'name'>): string {
  return postfach.name.replace(/-Postfach$/, '');
}

/** The mailbox named in the address, or the first one (Kontakt, seen by all Leitende). */
export function postfachAusAdresse(search: string): string {
  const id = new URLSearchParams(search).get('postfach');
  return (id && findPostfach(id)?.id) || POSTFAECHER[0].id;
}

/**
 * One module for all shared mailboxes (`api/lib/postfach-liste.ts`); the page offers a choice
 * between the mailboxes the person sees. Shown to the teams of any of them.
 */
export const POSTFACH_MODULE: StaffModule = {
  href: POSTFACH_PATH,
  title: 'Postfächer',
  description:
    'E-Mails an kontakt@, vorstand@ und die anderen Adressen des Stammes lesen, Zuständige festlegen und in Outlook antworten.',
  intro:
    'Oben wählst du das Postfach, wenn du mehrere siehst. Stand und Zuständigkeit stehen auch in Outlook: „Handlungsbedarf“ ist ein Fähnchen, „Erledigt“ heißt archiviert, die zuständige Person ist eine Kategorie mit 👤. Was du hier oder in Outlook änderst, sehen alle. Antworten und Löschen gehen in Outlook. Wer zuständig wird, bekommt eine Mail.',
  wrap: 'Post|fächer',
  keywords: [
    'mail',
    'e-mail',
    'postfach',
    'outlook',
    'posteingang',
    ...POSTFAECHER.flatMap((postfach) => [postfach.name, postfach.address]),
  ],
  icon: ICON,
  roles: [...new Set(POSTFAECHER.flatMap(postfachRoles))],
};

/** Pages of single mailboxes from before the module „Postfächer“; links in old mails lead there. */
export const ALTE_POSTFACH_PFADE: string[] = POSTFAECHER.map(
  (postfach) => `${POSTFACH_PATH}/${postfach.id}`
);

/** A saved path of a single mailbox (favorite, recent, count) becomes the module „Postfächer“. */
export function aktuellerModulPfad(path: unknown): unknown {
  return typeof path === 'string' && ALTE_POSTFACH_PFADE.includes(path) ? POSTFACH_PATH : path;
}

/** Recently opened areas with the old mailbox paths merged into the module, without repeats. */
export function aktuelleModulPfade(paths: string[]): string[] {
  return [...new Set(paths.map((path) => aktuellerModulPfad(path) as string))];
}

/** Counts of opened areas with the old mailbox paths added to the module. */
export function aktuelleZaehler(counts: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [path, count] of Object.entries(counts)) {
    const key = aktuellerModulPfad(path) as string;
    result[key] = (result[key] ?? 0) + count;
  }
  return result;
}
