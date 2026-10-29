/** Validation of what the Leitendenbereich keeps per person: settings, recent areas, favorites. */
import { z } from 'zod';
import { isChangelogId } from '../changelog-id';
import { pickStaffSettings } from '../staff-settings-model';
import type { StaffSettings } from '../staff-settings-model';
import { lenientObject, parseWith } from './zod';

/** More than the Leitendenbereich has modules, so a full selection always fits. */
const MAX_FAVORITES = 50;
const FAVORITE_PATH = /^\/leitendenbereich(?:\/[a-z0-9-]+)*\/?$/;

const SETTINGS_MESSAGE =
  'Die Einstellung ist ungültig. Bitte lade die Seite neu und wähle sie erneut.';
const FAVORITES_MESSAGE =
  'Die Favoriten sind ungültig. Bitte lade die Seite neu und wähle sie erneut.';

/** Whether every key of the settings is known and has a valid value, and there is one. */
function isKnownSettings(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false;
  const known = Object.keys(settings).length;
  return known > 0 && known === Object.keys(pickStaffSettings(settings)).length;
}

const settingsSchema = lenientObject({
  settings: z
    .unknown()
    .refine(isKnownSettings, { error: SETTINGS_MESSAGE })
    .transform(pickStaffSettings),
});

const recentVisitSchema = lenientObject({
  module: z
    .string({ error: 'Der Bereich ist ungültig.' })
    .regex(FAVORITE_PATH, { error: 'Der Bereich ist ungültig.' })
    .transform((module) => module.replace(/\/+$/, '')),
});

const changelogSeenSchema = lenientObject({
  lastSeenId: z.custom<string>(isChangelogId, { error: 'Die Neuigkeit ist ungültig.' }),
});

const favoritesSchema = lenientObject({
  modules: z
    .array(
      z.string({ error: FAVORITES_MESSAGE }).regex(FAVORITE_PATH, { error: FAVORITES_MESSAGE }),
      { error: FAVORITES_MESSAGE }
    )
    .max(MAX_FAVORITES, { error: FAVORITES_MESSAGE })
    .transform((modules) => [...new Set(modules)]),
});

/**
 * Module paths as stored: the strings of a JSON list, anything else dropped. Not a validation
 * of input, so a damaged value reads as an empty list.
 */
export const storedModulesSchema = z
  .array(z.unknown())
  .catch([])
  .transform((modules) => modules.filter((module): module is string => typeof module === 'string'));

/** The settings to merge; only known keys with valid values pass (`staff-settings-model.ts`). */
export function validateStaffSettings(body: unknown): StaffSettings {
  return parseWith(settingsSchema, body).settings;
}

/** The module a person just opened (`{ module }`), for the recently used areas. */
export function validateStaffRecentVisit(body: unknown): string {
  return parseWith(recentVisitSchema, body).module;
}

/** The ID of the newest changelog entry a person has seen (`{ lastSeenId }`). */
export function validateChangelogSeen(body: unknown): string {
  return parseWith(changelogSeenSchema, body).lastSeenId;
}

/** The favorites of the start page (`{ modules }`): paths of Leitendenbereich modules. */
export function validateStaffFavorites(body: unknown): string[] {
  return parseWith(favoritesSchema, body).modules;
}
