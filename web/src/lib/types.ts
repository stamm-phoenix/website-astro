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

export interface Aktion {
  id: string;
  stufen: string[];
  title: string;
  campflow_link?: string;
  description?: string;
  start: string;
  end: string;
}

export interface BlogPost {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  hasImage: boolean;
}

export interface DownloadFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  downloadUrl?: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  thumbnails?: {
    large: string;
    medium: string;
    small: string;
  };
}

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
    logo: '/dpsg-lilie_woelflinge_orange.png',
    label: 'Wölflinge',
  },
  Jungpfadfinder: {
    color: 'var(--color-dpsg-jupfis)',
    logo: '/dpsg-lilie_jungpfadfinder_blau.png',
    label: 'Jungpfadfinder',
  },
  Pfadfinder: {
    color: 'var(--color-dpsg-pfadfinder)',
    logo: '/dpsg-lilie_pfadfinder_gruen.png',
    label: 'Pfadfinder',
  },
  Rover: {
    color: 'var(--color-dpsg-rover)',
    logo: '/lilie_rover.png',
    label: 'Rover',
  },
};

export interface BuildInfo {
  commit: string | null;
  shortCommit: string | null;
  commitUrl: string | null;
  builtAt: string;
}

export interface NikolausSlot {
  /** Local slot key, e.g. `2026-12-05T17:00`. */
  key: string;
  date: string;
  time: string;
  endTime: string;
  capacity: number;
  available: number;
}

export interface NikolausBookingRequest {
  familyName: string;
  email: string;
  phone: string;
  slot: string;
  withKrampus: boolean;
  /** Honeypot, must stay empty. */
  website: string;
}

export interface NikolausBookingCreated {
  status: 'pending';
  reservedUntil?: string;
}

export interface NikolausBookingInfo {
  id: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  familyName: string;
  withKrampus: boolean;
  slot: { key: string; date: string; time: string; endTime: string } | null;
  reservedUntil: string | null;
}
