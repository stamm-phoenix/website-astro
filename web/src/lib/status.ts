/** Semantic text colours used by StatusLabel across modules. */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

/** Result of an action, shared by inline notices and popups. */
export type NoticeKind = 'success' | 'warning' | 'error';
export interface Notice {
  text: string;
  kind: NoticeKind;
}
export const NOTICE_CLASS: Record<NoticeKind, string> = {
  success: 'border-l-success text-success',
  warning: 'border-l-warning text-warning',
  error: 'border-l-danger text-danger',
};
