/**
 * Settings of a logged-in person in the Leitendenbereich (`organisation.staff_settings`), shared
 * by the API and the frontend (`web/src/lib/staffSettingsStore.svelte.ts`). Free of imports.
 */

/**
 * How the agenda of the minutes is written: the formatting editor, a Markdown field per item
 * (#320), or the whole agenda as one Markdown text (#613).
 */
export const TEXT_MODI = ['formatiert', 'markdown', 'markdown-dokument'] as const;
export type TextModus = (typeof TEXT_MODI)[number];

/** Every key is optional; a missing key means the default applies. */
export interface StaffSettings {
  protokollText?: TextModus;
}

/** Keeps the known keys with valid values; anything else is dropped. */
export function pickStaffSettings(value: unknown): StaffSettings {
  const settings: StaffSettings = {};
  if (!value || typeof value !== 'object') return settings;
  const { protokollText } = value as Record<string, unknown>;
  if (TEXT_MODI.includes(protokollText as TextModus)) {
    settings.protokollText = protokollText as TextModus;
  }
  return settings;
}
