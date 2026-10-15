/** Whom Leitende can ask when something does not work. Change the addresses only here. */
export const HELP_CONTACTS = {
  /** Technical problems: saving, loading, logging in. */
  technik: 'it@stamm-phoenix.de',
  /** Everything else, e.g. missing permissions or questions about a module. */
  allgemein: 'kontakt@stamm-phoenix.de',
} as const;

/** Next step after a server error, when trying again may not help. */
export const TECHNIK_HELP = `Klappt es auch beim nächsten Versuch nicht, schreib an ${HELP_CONTACTS.technik}.`;

/** Next step when an action is not allowed for the user. */
export const PERMISSION_HELP = `Wenn du sie brauchst, schreib an ${HELP_CONTACTS.allgemein}.`;
