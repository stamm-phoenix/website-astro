/** A tile on the start page of the Leitendenbereich. */
export interface StaffModule {
  href: string;
  title: string;
  description: string;
  /** SVG path data for a 24×24 stroke icon. */
  icon: string;
}

export const STAFF_MODULES: StaffModule[] = [
  {
    href: '/leitendenbereich/aktionen',
    title: 'Aktionen',
    description: 'Aktionen aus CampFlow mit den Teilnehmendenlisten ansehen.',
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  },
  {
    href: '/leitendenbereich/nikolaus',
    title: 'Nikolaus',
    description: 'Anmeldungen zum Nikolausdienst als Liste oder Terminmatrix ansehen.',
    icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z',
  },
];
