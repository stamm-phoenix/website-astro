import { POSTFAECHER, postfachRoles } from '../../../api/lib/postfach-liste';
import type { StaffModule } from './staffModules';

/** Envelope, 24×24 stroke. */
const ICON = 'M3 6h18v12H3zM3 7l9 6 9-6';

/** Path of the page of a mailbox. */
export function postfachHref(id: string): string {
  return `/leitendenbereich/email/${id}`;
}

/**
 * One module per shared mailbox (`api/lib/postfach-liste.ts`), only for the teams of the mailbox;
 * the start page lists them in the section „E-Mail“.
 */
export const POSTFACH_MODULES: StaffModule[] = POSTFAECHER.map((postfach) => ({
  href: postfachHref(postfach.id),
  title: postfach.name,
  description: postfach.description,
  intro:
    'Stand und Zuständigkeit stehen auch in Outlook: „Handlungsbedarf“ ist ein Fähnchen, „Erledigt“ heißt archiviert, die zuständige Person ist eine Kategorie mit 👤. Was du hier oder in Outlook änderst, sehen alle. Antworten und Löschen gehen in Outlook. Wer zuständig wird, bekommt eine Mail.',
  wrap: postfach.name.replace('-', '-|'),
  keywords: ['mail', 'e-mail', 'postfach', 'outlook', 'posteingang', postfach.address],
  icon: ICON,
  roles: postfachRoles(postfach),
}));
