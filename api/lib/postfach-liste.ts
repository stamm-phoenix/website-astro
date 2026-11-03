/**
 * The shared mailboxes shown in the Leitendenbereich (module group „E-Mail“, `docs/postfaecher.md`).
 * Shared by the API and the web frontend (`web/src/lib/postfaecher.ts`), so it stays free of
 * imports and of Node or browser APIs.
 *
 * Who may see a mailbox is set here and not read from Exchange: Microsoft Graph has no access to
 * the permissions of a mailbox (Full Access, Send As), only Exchange Online PowerShell has. Keep
 * `teams` in line with the members that have Full Access to the mailbox in Exchange, so that „In
 * Outlook öffnen“ works for everyone who sees the mailbox here.
 */

/** Keys of `CONFIG.staff.teams`; checked against it by `test/postfach-liste.test.ts`. */
export type PostfachTeam = 'leitende' | 'kasse' | 'vorstand' | 'admin';

export interface PostfachEintrag {
  /** Part of the page address `/leitendenbereich/email/<id>` and of the stored rows; never change it. */
  id: string;
  /** Name of the tile and the page. */
  name: string;
  /** Address of the shared mailbox in Exchange Online. */
  address: string;
  /** One sentence for the start page and the search. */
  description: string;
  /** Members of one of these teams see the mailbox; one is enough. */
  teams: readonly PostfachTeam[];
}

export const POSTFAECHER: readonly PostfachEintrag[] = [
  {
    id: 'kontakt',
    name: 'Kontakt-Postfach',
    address: 'kontakt@stamm-phoenix.de',
    description:
      'E-Mails an kontakt@stamm-phoenix.de lesen, Zuständige festlegen und in Outlook antworten.',
    teams: ['leitende'],
  },
];

/** The role of Static Web Apps of a team, as `GetRoles` hands it out (`team_<key>`). */
export function postfachTeamRole(team: PostfachTeam): string {
  return `team_${team}`;
}

/** The roles that may see the mailbox, for `roles` of the module and the API check. */
export function postfachRoles(postfach: PostfachEintrag): string[] {
  return postfach.teams.map(postfachTeamRole);
}

export function findPostfach(id: string): PostfachEintrag | undefined {
  return POSTFAECHER.find((postfach) => postfach.id === id);
}

/** Outlook on the web with the shared mailbox open; needs Full Access in Exchange. */
export function postfachOutlookUrl(address: string): string {
  return `https://outlook.office.com/mail/${encodeURIComponent(address)}/`;
}

/**
 * Outlook on the web with one message of the shared mailbox open; Outlook shows the whole
 * conversation around it. `restId` is the Outlook REST ID of the message, not the immutable one.
 */
export function nachrichtOutlookUrl(address: string, restId: string): string {
  return `${postfachOutlookUrl(address)}inbox/id/${encodeURIComponent(restId)}`;
}
