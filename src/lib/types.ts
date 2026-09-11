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

export interface QuestionAndAnswer {
  id: string;
  question: string;
  answer: string;
  category: string;
}

/**
 * Determines whether a value contains a valid question-and-answer entry.
 *
 * @param item - The value to inspect
 * @returns `true` if the value has string `id`, `question`, `answer`, and `category` fields, `false` otherwise.
 */
function isQuestionAndAnswer(item: unknown): item is QuestionAndAnswer {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.question === 'string' &&
    typeof candidate.answer === 'string' &&
    typeof candidate.category === 'string'
  );
}

/**
 * Validates a public Q&A API response.
 *
 * @param value - The untrusted API response to validate
 * @returns The validated list of Q&A entries
 * @throws A `TypeError` if the response does not contain valid Q&A entries
 */
export function parseQuestionsAndAnswers(value: unknown): QuestionAndAnswer[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid Q&A response');
  }

  if (!value.every(isQuestionAndAnswer)) {
    throw new TypeError('Invalid Q&A response');
  }

  return value;
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
