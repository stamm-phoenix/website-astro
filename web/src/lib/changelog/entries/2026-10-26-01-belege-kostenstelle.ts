import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-26-01-belege-kostenstelle',
  date: '2026-10-26',
  title: 'Belege: Kostenstelle und Kategorie statt Aktion',
  changes: [
    {
      text: 'Beim Einreichen eines Belegs wählst du jetzt Kostenstelle und Kategorie wie in CampFlow, statt eine Aktion anzugeben. So geht auch Verpflegung für die Leitendenrunde, die zu keiner Aktion gehört.',
      href: '/leitendenbereich/belege',
    },
    'Im Feld „Kostenstelle“ suchst du Kostenstellen und Kategorien zugleich: Tippst du z. B. „leite“, bekommst du die Kostenstelle „Leitendenlager“ und die Kategorie „Leitendenrunde“ in „Allgemein“ angeboten. Eine Kategorie füllt beide Felder aus. Gibt es eine Kategorie in vielen Kostenstellen, grenzt du mit einem weiteren Wort ein, z. B. „verpflegung stammes“.',
    'Die Kategorien des KJR (Fahrtkosten, Verpflegungskosten, Miet- und Übernachtungskosten, Honorare, Arbeits- und Hilfsmittel) stehen bei jeder Kostenstelle zur Auswahl, auch wenn es sie dort noch nicht gibt.',
    'Du kannst Kostenstelle und Kategorie auch frei eintippen. Gibt es sie in CampFlow noch nicht, siehst du einen Hinweis; die Kasse legt sie beim Übertragen nach CampFlow automatisch an.',
  ],
};

export default entry;
