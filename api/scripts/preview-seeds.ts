import { seedPreviewContentReviews } from '../lib/db-preview-content-review';
import { seedPreviewAktionen } from '../lib/db-preview-aktionen';
import { seedPreviewStaffUsage } from '../lib/staff-usage-preview';
import {
  seedPreviewProtokolle,
  seedPreviewTasks,
  seedPreviewAttendance,
  seedPreviewProtokollEditor,
  seedPreviewPersonen,
  seedPreviewAktionenOhneZuschuss,
  seedPreviewKeineAktionen,
  seedPreviewStaffChangelogSeen,
  seedPreviewStaffFavorites,
  seedPreviewStaffRecent,
  seedPreviewStaffSettings,
  seedPreviewAbrechnungEingabe,
  seedPreviewSammel,
  seedPreviewAbstimmungen,
  seedPreviewEssensplanung,
  seedPreviewProblemmeldungen,
  seedPreviewEssensplanungPlanung,
  seedPreviewEssensplanungGerichte,
  seedPreviewEssensplanungEinplanung,
  seedPreviewEssensplanungTeilnehmende,
  seedPreviewGruppenstunden,
  seedPreviewLeitende,
  seedPreviewBelege,
  seedPreviewBelegeCampflow,
  seedPreviewBlog,
  seedPreviewQuestions,
} from '../lib/db-preview';
import { seedPreviewAktionDownloads, seedPreviewDownloads } from '../lib/db-preview-downloads';
import { seedPreviewEssensplanungEinkauf } from '../lib/db-preview-essen-einkauf';
import { seedPreviewEssensplanungPackliste } from '../lib/db-preview-essen-packliste';
import { seedPreviewEssensplanungBelege } from '../lib/db-preview-essen-belege';
import { seedPreviewEssensplanungLeitung } from '../lib/db-preview-essen-leitung';
import { seedPreviewInventur } from '../lib/db-preview-inventur';
import { seedPreviewSchnupperanfragen } from '../lib/db-preview-schnupper';
import { seedPreviewPostfach } from '../lib/db-preview-postfach';
import { seedPreviewEssensplanungKochen } from '../lib/db-preview-essen-kochen';
import { seedPreviewEssensplanungEinkaeufe } from '../lib/db-preview-essen-einkaeufe';
import { createTestData, createTestHelpers } from './nikolaus-testdata';
import { seedPreviewPlans } from '../lib/db-preview-plans';
import { runSeedTracks } from '../lib/preview-seed-runner';

/** Independent domains overlap network waits; dependencies within each track stay ordered. */
export async function seedPreviewData(): Promise<void> {
  await runSeedTracks([
    [
      { name: 'createTestData', run: () => createTestData(false, null) },
      { name: 'createTestHelpers', run: () => createTestHelpers(false, true) },
      { name: 'seedPreviewPlans', run: () => seedPreviewPlans() },
    ],
    [
      { name: 'seedPreviewQuestions', run: () => seedPreviewQuestions() },
      { name: 'seedPreviewBlog', run: () => seedPreviewBlog() },
      { name: 'seedPreviewGruppenstunden', run: () => seedPreviewGruppenstunden() },
      { name: 'seedPreviewLeitende', run: () => seedPreviewLeitende() },
      { name: 'seedPreviewAktionen', run: () => seedPreviewAktionen() },
      { name: 'seedPreviewBelege', run: () => seedPreviewBelege() },
      { name: 'seedPreviewBelegeCampflow', run: () => seedPreviewBelegeCampflow() },
      { name: 'seedPreviewDownloads', run: () => seedPreviewDownloads() },
      { name: 'seedPreviewAktionDownloads', run: () => seedPreviewAktionDownloads() },
      { name: 'seedPreviewContentReviews', run: () => seedPreviewContentReviews() },
    ],
    // Self-contained steps that alone took 40 s, 28 s and 11 s: each only touches its own
    // schema (`gruppenstunde`, `sammel`, `abstimmung`), so they must not wait for the others
    [{ name: 'seedPreviewAttendance', run: () => seedPreviewAttendance() }],
    [{ name: 'seedPreviewSammel', run: () => seedPreviewSammel() }],
    [{ name: 'seedPreviewAbstimmungen', run: () => seedPreviewAbstimmungen() }],
    [
      { name: 'seedPreviewTasks', run: () => seedPreviewTasks() },
      { name: 'seedPreviewProtokolle', run: () => seedPreviewProtokolle() },
      { name: 'seedPreviewProtokollEditor', run: () => seedPreviewProtokollEditor() },
      { name: 'seedPreviewPersonen', run: () => seedPreviewPersonen() },
      { name: 'seedPreviewAktionenOhneZuschuss', run: () => seedPreviewAktionenOhneZuschuss() },
      { name: 'seedPreviewKeineAktionen', run: () => seedPreviewKeineAktionen() },
      { name: 'seedPreviewStaffFavorites', run: () => seedPreviewStaffFavorites() },
      { name: 'seedPreviewStaffChangelogSeen', run: () => seedPreviewStaffChangelogSeen() },
      { name: 'seedPreviewStaffRecent', run: () => seedPreviewStaffRecent() },
      { name: 'seedPreviewStaffUsage', run: () => seedPreviewStaffUsage() },
      { name: 'seedPreviewStaffSettings', run: () => seedPreviewStaffSettings() },
      { name: 'seedPreviewAbrechnungEingabe', run: () => seedPreviewAbrechnungEingabe() },
      { name: 'seedPreviewProblemmeldungen', run: () => seedPreviewProblemmeldungen() },
      { name: 'seedPreviewInventur', run: () => seedPreviewInventur() },
      { name: 'seedPreviewSchnupperanfragen', run: () => seedPreviewSchnupperanfragen() },
      { name: 'seedPreviewPostfach', run: () => seedPreviewPostfach() },
    ],
    [
      { name: 'seedPreviewEssensplanung', run: () => seedPreviewEssensplanung() },
      { name: 'seedPreviewEssensplanungPlanung', run: () => seedPreviewEssensplanungPlanung() },
      { name: 'seedPreviewEssensplanungGerichte', run: () => seedPreviewEssensplanungGerichte() },
      {
        name: 'seedPreviewEssensplanungEinplanung',
        run: () => seedPreviewEssensplanungEinplanung(),
      },
      {
        name: 'seedPreviewEssensplanungTeilnehmende',
        run: () => seedPreviewEssensplanungTeilnehmende(),
      },
      { name: 'seedPreviewEssensplanungEinkauf', run: () => seedPreviewEssensplanungEinkauf() },
      { name: 'seedPreviewEssensplanungKochen', run: () => seedPreviewEssensplanungKochen() },
      { name: 'seedPreviewEssensplanungEinkaeufe', run: () => seedPreviewEssensplanungEinkaeufe() },
      { name: 'seedPreviewEssensplanungPackliste', run: () => seedPreviewEssensplanungPackliste() },
      { name: 'seedPreviewEssensplanungBelege', run: () => seedPreviewEssensplanungBelege() },
      { name: 'seedPreviewEssensplanungLeitung', run: () => seedPreviewEssensplanungLeitung() },
    ],
  ]);
}
