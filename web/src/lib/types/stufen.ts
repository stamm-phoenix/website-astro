/** The Stufen of the stamm and their colors. */
export type GroupKey = 'Woelflinge' | 'Jungpfadfinder' | 'Pfadfinder' | 'Rover';

export const STUFE_TO_KEY: Record<string, GroupKey> = {
  Wölflinge: 'Woelflinge',
  Jungpfadfinder: 'Jungpfadfinder',
  Pfadfinder: 'Pfadfinder',
  Rover: 'Rover',
};

export const STUFE_ORDER: Record<string, number> = {
  Wölflinge: 1,
  Jungpfadfinder: 2,
  Pfadfinder: 3,
  Rover: 4,
};

export const GROUP_CONFIG: Record<GroupKey, { color: string; logo: string; label: string }> = {
  Woelflinge: {
    color: 'var(--color-dpsg-woelflinge)',
    logo: '/stufen/woelflinge.webp',
    label: 'Wölflinge',
  },
  Jungpfadfinder: {
    color: 'var(--color-dpsg-jupfis)',
    logo: '/stufen/jungpfadfinder.webp',
    label: 'Jungpfadfinder',
  },
  Pfadfinder: {
    color: 'var(--color-dpsg-pfadfinder)',
    logo: '/stufen/pfadfinder.webp',
    label: 'Pfadfinder',
  },
  Rover: {
    color: 'var(--color-dpsg-rover)',
    logo: '/stufen/rover.webp',
    label: 'Rover',
  },
};
