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
    href: '/leitendenbereich/nikolaus',
    title: 'Nikolaus',
    description: 'Anmeldungen zum Nikolausdienst als Liste oder Terminmatrix ansehen.',
    icon: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z',
  },
];
