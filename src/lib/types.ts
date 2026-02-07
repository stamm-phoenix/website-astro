export interface Leitende {
  id: string;
  name: string;
  teams: string[];
  hasImage: boolean;
}

export interface Vorstand {
  id: string;
  name: string;
  telephone?: string;
  street?: string;
  city?: string;
  hasImage: boolean;
}

export interface GruppenstundeLeitende {
  id: string;
  name: string;
  hasImage: boolean;
}

export interface Gruppenstunde {
  id: string;
  stufe: string;
  weekday: string;
  time: string;
  location: string;
  ageRange: string;
  description: string;
  leitende: GruppenstundeLeitende[];
}

export type GroupKey = "Woelflinge" | "Jungpfadfinder" | "Pfadfinder" | "Rover";

export const STUFE_TO_KEY: Record<string, GroupKey> = {
  Wölflinge: "Woelflinge",
  Jungpfadfinder: "Jungpfadfinder",
  Pfadfinder: "Pfadfinder",
  Rover: "Rover",
};

export const STUFE_ORDER: Record<string, number> = {
  Wölflinge: 1,
  Jungpfadfinder: 2,
  Pfadfinder: 3,
  Rover: 4,
};

export const GROUP_CONFIG: Record<
  GroupKey,
  { color: string; logo: string; label: string }
> = {
  Woelflinge: {
    color: "var(--color-dpsg-woelflinge)",
    logo: "/dpsg-lilie_woelflinge_orange.png",
    label: "Wölflinge",
  },
  Jungpfadfinder: {
    color: "var(--color-dpsg-jupfis)",
    logo: "/dpsg-lilie_jungpfadfinder_blau.png",
    label: "Jungpfadfinder",
  },
  Pfadfinder: {
    color: "var(--color-dpsg-pfadfinder)",
    logo: "/dpsg-lilie_pfadfinder_gruen.png",
    label: "Pfadfinder",
  },
  Rover: {
    color: "var(--color-dpsg-rover)",
    logo: "/lilie_rover.png",
    label: "Rover",
  },
};
