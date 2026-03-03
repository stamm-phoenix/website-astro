export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  category: string;
  color: string;
  image: {
    src: string;
    alt: string;
  };
}

export const blogPosts: BlogPost[] = [
  {
    id: 'fruehlingslager-2026',
    title: 'Frühlingslager 2026: Feuer, Freundschaft & Pfadfindergeist',
    excerpt:
      'Drei Tage draußen, eine große Jurte und viele neue Mutproben. Unser Frühlingslager hat gezeigt, wie viel Gemeinschaft in uns steckt.',
    date: '2026-02-18',
    readTime: '4 min',
    category: 'Lagerleben',
    color: 'bg-[var(--color-dpsg-woelflinge)]/15 text-[var(--color-dpsg-woelflinge)]',
    image: {
      src: '/blog/fruehlingslager.svg',
      alt: 'Kinder sitzen am Lagerfeuer in der Jurte',
    },
  },
  {
    id: 'nachtwanderung-2026',
    title: 'Nachtwanderung mit Kompass & Teamgeist',
    excerpt:
      'Mit Karte, Kompass und Sternenlicht durch den Wald: Unsere Pfadis zeigen, wie man als Team die Orientierung behält.',
    date: '2026-01-30',
    readTime: '3 min',
    category: 'Abenteuer',
    color: 'bg-[var(--color-dpsg-pfadfinder)]/15 text-[var(--color-dpsg-pfadfinder)]',
    image: {
      src: '/blog/nachtwanderung.svg',
      alt: 'Pfadfinder laufen mit Lampen durch den Wald',
    },
  },
  {
    id: 'stufenwechsel-2026',
    title: 'Stufenwechsel: Neue Rollen, neue Wege',
    excerpt:
      'Ein Abend voller Dankbarkeit und Aufbruch. Wir feiern unsere Leiter:innen und begrüßen die nächsten Schritte.',
    date: '2026-01-12',
    readTime: '5 min',
    category: 'Stammesleben',
    color: 'bg-[var(--color-dpsg-rover)]/15 text-[var(--color-dpsg-rover)]',
    image: {
      src: '/blog/stufenwechsel.svg',
      alt: 'Pfadfinder halten Tücher in der Abendsonne',
    },
  },
];
