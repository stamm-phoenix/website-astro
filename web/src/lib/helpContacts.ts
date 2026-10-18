import { HELP_CONTACTS } from '../../../api/lib/help-contacts';
export { HELP_CONTACTS } from '../../../api/lib/help-contacts';

/** Next step after a server error, when trying again may not help. */
export const TECHNIK_HELP = `Klappt es auch beim nächsten Versuch nicht, schreib an ${HELP_CONTACTS.technik}.`;

/** Next step when an action is not allowed for the user. */
export const PERMISSION_HELP = `Wenn du sie brauchst, schreib an ${HELP_CONTACTS.allgemein}.`;
