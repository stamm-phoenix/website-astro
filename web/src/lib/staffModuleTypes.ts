/** Types of the pages and modules of the Leitendenbereich; the lists are in `staffModuleList.ts`, `staffModulesNikolaus.ts` and `staffSubpages.ts`. */
/** A page of the Leitendenbereich. `StaffLayout.astro` builds its title, header and breadcrumb from it. */
export interface StaffPage {
  href: string;
  /** Name on the start page. */
  title: string;
  /** Heading, breadcrumb and browser title, when the page needs more context than `title`. */
  heading?: string;
  /** Short description for the start page and the meta description. */
  description: string;
  /** Text under the heading; `description` when omitted. */
  intro?: string;
  /** href of the page above this one in the breadcrumb; the start page when omitted. */
  parent?: string;
  /** Links to the page load it in full instead of a view transition. */
  reload?: boolean;
  /** Show the intro as a paragraph; otherwise it waits behind the „(i)“ next to the heading, so the content starts high up. */
  introOpen?: boolean;
}

/** A tile on the start page of the Leitendenbereich. */
export interface StaffModule extends StaffPage {
  /** SVG path data for a 24×24 stroke icon. */
  icon: string;
  /** Other words people search for, beyond title and description (`staffSearch.ts`). */
  keywords?: string[];
  /** The title with `|` where a long word may break in narrow places (tiles, the bar). */
  wrap?: string;
  /**
   * The title on tiles and in the bar, where no section names the module, when `title` alone
   * would be ambiguous there (two modules „Steuerung“); `|` as in `wrap`.
   */
  shortcut?: string;
  /**
   * Only for these roles of the teams (`CONFIG.staff.teams`), one of them is enough; the module is
   * hidden from everyone else. Its API checks the teams with `hasTeam`; the page itself stays under
   * `team_leitende`, because a route of its own in `staticwebapp.config.json` could only allow
   * these roles instead of Leitende, not in addition.
   */
  roles?: string[];
}

/** The page that lists the changes of the Leitendenbereich; its bubble counts the unread ones. */
export const CHANGELOG_PATH = '/leitendenbereich/neuigkeiten';
