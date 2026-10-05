// The contact form rules are shared with the API, which validates messages against them.
// Edit them in api/lib/kontakt-validation.ts.
export {
  KONTAKT_MAX_LENGTH,
  KONTAKT_MIN_MESSAGE_LENGTH,
  KONTAKT_TOPICS,
  validateKontaktMessage,
} from '../../../api/lib/kontakt-validation';
export type {
  KontaktField,
  KontaktMessage,
  KontaktTopic,
} from '../../../api/lib/kontakt-validation';
