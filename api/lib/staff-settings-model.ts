/**
 * Settings of a logged-in person in the Leitendenbereich (`organisation.staff_settings`), shared
 * by the API and the frontend (`web/src/lib/staffSettingsStore.svelte.ts`). Free of imports.
 */

/** How the texts of the minutes are written: the formatting editor or the Markdown field (#320). */
export const TEXT_MODI = ['formatiert', 'markdown'] as const;
export type TextModus = (typeof TEXT_MODI)[number];

/** Whether the sidebar of the Leitendenbereich shows names or only icons (wide screens). */
export const SEITENLEISTE_MODI = ['ausgeklappt', 'eingeklappt'] as const;
export type SeitenleisteModus = (typeof SEITENLEISTE_MODI)[number];

/** Every key is optional; a missing key means the default applies. */
export interface StaffSettings {
  protokollText?: TextModus;
  seitenleiste?: SeitenleisteModus;
}

/** Keeps the known keys with valid values; anything else is dropped. */
export function pickStaffSettings(value: unknown): StaffSettings {
  const settings: StaffSettings = {};
  if (!value || typeof value !== 'object') return settings;
  const { protokollText, seitenleiste } = value as Record<string, unknown>;
  if (TEXT_MODI.includes(protokollText as TextModus)) {
    settings.protokollText = protokollText as TextModus;
  }
  if (SEITENLEISTE_MODI.includes(seitenleiste as SeitenleisteModus)) {
    settings.seitenleiste = seitenleiste as SeitenleisteModus;
  }
  return settings;
}
