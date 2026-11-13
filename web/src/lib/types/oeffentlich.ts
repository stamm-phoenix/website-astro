/** Types of the public site: Leitende, Gruppenstunden, Aktionen, downloads, blog, Instagram and Q&A. */
import type { GruppenstundenException } from '../../../../api/lib/gruppenstunden-exception-model';
import type { QuestionAndAnswer, StaffQuestionAndAnswer } from '../../../../api/lib/qa-model';

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
  exception?: GruppenstundenException | null;
}

export interface Aktion {
  meetingPoint?: string;
  packingList?: string[];
  downloads?: DownloadFile[];
  id: string;
  stufen: string[];
  title: string;
  campflow_link?: string;
  description?: string;
  start: string;
  end: string;
}

export interface DownloadFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  /** There are preview images (`/api/downloads/<id>/image/<size>`). */
  hasPreview: boolean;
  /** Topic the list is filtered by. */
  category: string;
  createdAt: string;
  lastModifiedAt: string;
}

export interface BuildInfo {
  commit: string | null;
  shortCommit: string | null;
  commitUrl: string | null;
  builtAt: string;
}

export interface InstagramPost {
  id: string;
  caption?: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  timestamp: string;
  /** Number of images; more than one for carousels */
  imageCount: number;
  /** Whether the video can be played on the site; missing e.g. for reels with licensed music */
  hasVideo: boolean;
}

/** Cover image of a blog post. */
export interface BlogCover {
  url: string;
  alt: string;
  width: number;
  height: number;
}

/** A published blog post as listed on the website. */
export interface BlogPostSummary {
  id: string;
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  excerpt: string;
  readingMinutes: number;
  cover?: BlogCover;
}

/** A published blog post with its content (sanitized HTML with complete image tags). */
export interface BlogPost extends BlogPostSummary {
  content: string;
}

export interface StaffQuestionsData {
  items: StaffQuestionAndAnswer[];
  categories: string[];
  allowCustomCategories: boolean;
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
