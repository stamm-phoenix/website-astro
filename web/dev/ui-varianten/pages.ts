/** Pages listed in the /ui-vorschau overview, grouped like the site. */
export interface PreviewPage {
  href: string;
  label: string;
  note?: string;
}

export interface PreviewGroup {
  title: string;
  pages: PreviewPage[];
}

export const PREVIEW_GROUPS: PreviewGroup[] = [
  {
    title: 'Öffentlich',
    pages: [
      { href: '/', label: 'Start' },
      { href: '/gruppenstunden', label: 'Gruppenstunden' },
      { href: '/aktionen', label: 'Aktionen' },
      { href: '/blog', label: 'Blog' },
      { href: '/blog/beitrag?id=14', label: 'Blogbeitrag' },
      { href: '/downloads', label: 'Downloads' },
      { href: '/fragen-und-antworten', label: 'Fragen & Antworten' },
      { href: '/vorstand', label: 'Vorstand' },
      { href: '/kontakt', label: 'Kontakt' },
      { href: '/mitmachen', label: 'Mitmachen' },
      { href: '/impressum', label: 'Impressum' },
      { href: '/gibt-es-nicht', label: '404' },
    ],
  },
  {
    title: 'Nikolaus',
    pages: [
      { href: '/nikolaus', label: 'Nikolaus buchen' },
      { href: '/nikolaus/termin?token=abc', label: 'Termin verwalten' },
      { href: '/nikolaus/termin?token=pending', label: 'Termin (unbestätigt)' },
    ],
  },
  {
    title: 'Mitgliederbereich',
    pages: [
      {
        href: '/mitgliederbereich/sammelbestellungen#kind=order&id=2001&token=demo',
        label: 'Bestellung bearbeiten',
      },
      {
        href: '/mitgliederbereich/sammelbestellungen#kind=campaign&id=101&token=demo',
        label: 'Einladung',
      },
    ],
  },
  {
    title: 'Leitendenbereich',
    pages: [
      { href: '/leitendenbereich', label: 'Übersicht' },
      { href: '/leitendenbereich/sammelbestellungen', label: 'Sammelbestellungen' },
      { href: '/leitendenbereich/sammelbestellungen/101', label: 'Sammelbestellung (offen)' },
      { href: '/leitendenbereich/sammelbestellungen/103', label: 'Sammelbestellung (fertig)' },
      { href: '/leitendenbereich/fragen-und-antworten', label: 'Fragen & Antworten' },
      { href: '/leitendenbereich/aktionen', label: 'Aktionen' },
      { href: '/leitendenbereich/aktionen/aktion?id=evt_WoeHerbst', label: 'Aktion (Detail)' },
      { href: '/leitendenbereich/gruppenstunden', label: 'Gruppenstunden' },
      { href: '/leitendenbereich/leitende', label: 'Leitende & Teams' },
      { href: '/leitendenbereich/downloads', label: 'Downloads' },
      { href: '/leitendenbereich/blog', label: 'Blog' },
      { href: '/leitendenbereich/blog/beitrag?id=14', label: 'Blogbeitrag bearbeiten' },
      { href: '/leitendenbereich/nikolaus', label: 'Nikolaus · Anmeldungen' },
      { href: '/leitendenbereich/nikolaus-dispo', label: 'Nikolaus · Dispo' },
      { href: '/leitendenbereich/nikolaus-fahrt?tag=2026-12-05&team=A', label: 'Nikolaus · Fahrt' },
      { href: '/leitendenbereich/nikolaus-helfende', label: 'Nikolaus · Helfende' },
      {
        href: '/leitendenbereich/nikolaus-helfende?ansicht=einteilung',
        label: 'Nikolaus · Einteilung',
      },
    ],
  },
];
