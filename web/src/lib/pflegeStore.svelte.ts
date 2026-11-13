import { createResource } from './resource.svelte';
import type { LeitungPlanung } from '../../../api/lib/essen-leitung-model';
import type { NamiAbgleichData } from '../../../api/lib/nami-abgleich-model';
import type { StaffProblemMeldungenData } from './problemMelden';
import type {
  AnwesenheitOverview,
  BeitraegeData,
  KostenstellenData,
  OffeneBeitraegeData,
  CampflowBelegeData,
  MitgliederData,
  ProtokollEditorOverview,
  SammelAktion,
  StaffAktionenData,
  StaffBeleg,
  StaffBlogListItem,
  StaffDownload,
  StaffGruppenstundenData,
  StaffLeitendeData,
  StaffNikolausSteuerung,
  StaffEssenSteuerung,
  StaffProtokolleData,
  StaffQuestionsData,
  PersonenUebersicht,
} from './types';

export const gruppenstundenPflege = createResource<StaffGruppenstundenData>(
  '/intern/pflege/gruppenstunden'
);
export const leitendePflege = createResource<StaffLeitendeData>('/intern/pflege/leitende');
export const downloadsPflege = createResource<StaffDownload[]>('/intern/pflege/downloads');
export const blogPflege = createResource<StaffBlogListItem[]>('/intern/pflege/blog');
export const faqPflege = createResource<StaffQuestionsData>('/intern/pflege/qa');
export const aktionenPflege = createResource<StaffAktionenData>('/intern/pflege/aktionen');
export const belegePflege = createResource<StaffBeleg[]>('/intern/pflege/belege', {
  loadError:
    'Die hier eingereichten Belege konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Belege erneut.',
});
export const protokollePflege = createResource<StaffProtokolleData>('/intern/pflege/protokolle');
export const personenPflege = createResource<PersonenUebersicht>('/intern/pflege/personen');
/** The Gruppenstunden with their recorded Termine; loaded again on every visit. */
export const anwesenheitOverview = createResource<AnwesenheitOverview>('/intern/anwesenheit', {
  loadError:
    'Die Anwesenheit konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
});
/** The minutes written in the editor; loaded again on every visit (who is writing changes). */
export const protokollEditorOverview = createResource<ProtokollEditorOverview>(
  '/intern/protokoll-editor',
  {
    loadError:
      'Die Protokolle konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
  }
);
/** All Sammelbestellungen; loaded again on every visit. */
export const sammelCampaigns = createResource<SammelAktion[]>('/intern/pflege/sammelbestellungen', {
  loadError:
    'Die Sammelbestellungen konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
});
export const nikolausSteuerung = createResource<StaffNikolausSteuerung>(
  '/intern/nikolaus/steuerung'
);

/** The own Planungen of the Essensplanung, each with a token to open it; loaded on every visit. */
export const essensplanungMeine = createResource<{ planungen: LeitungPlanung[] }>(
  '/intern/essensplanung/meine',
  {
    loadError:
      'Deine Essensplanungen konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
  }
);

/** Steuerung of the Essensplanung, only for the teams Admin and Vorstand. */
export const essensplanungSteuerung = createResource<StaffEssenSteuerung>(
  '/intern/essensplanung/steuerung'
);

/** All receipts in CampFlow, read-only; `refresh()` has them read from CampFlow again. */
export const campflowBelegeStore = createResource<CampflowBelegeData>(
  '/intern/pflege/belege/campflow',
  {
    idle: true,
    refreshable: true,
    loadError:
      'Die Belege aus CampFlow konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Belege erneut.',
  }
);

/** CampFlow's Beiträge, read-only; `refresh()` has them read from CampFlow again. */
export const beitraegeStore = createResource<BeitraegeData>('/intern/beitraege', {
  idle: true,
  refreshable: true,
});

/** Sums per Kostenstelle and Kategorie, read-only; `refresh()` exports CampFlow's report again. */
export const kostenstellenStore = createResource<KostenstellenData>(
  '/intern/kostenstellen/summen',
  {
    idle: true,
    refreshable: true,
    loadError:
      'Die Kostenstellen konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
  }
);

/** The Beiträge with something left to do and which of them are the own ones, for the start page. */
export const offeneBeitraegeStore = createResource<OffeneBeitraegeData>('/intern/beitraege/meine', {
  idle: true,
  loadError:
    'Deine Beiträge konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
});

/** The CampFlow member list with its groups, read-only; `refresh()` reads CampFlow again. */
export const namiAbgleichStore = createResource<NamiAbgleichData>('/intern/nami-abgleich', {
  idle: true,
  refreshable: true,
  loadError:
    'Der Nami-Abgleich konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
});

/** The member list from CampFlow; `refresh()` reads CampFlow again. */
export const mitgliederStore = createResource<MitgliederData>('/intern/mitglieder', {
  idle: true,
  refreshable: true,
  loadError:
    'Die Mitgliederliste konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
});

/** The Problemmeldungen of „Problem melden“; loaded again on every visit. */
export const problemmeldungenPflege = createResource<StaffProblemMeldungenData>(
  '/intern/pflege/problemmeldungen',
  {
    loadError:
      'Die Problemmeldungen konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Meldungen noch einmal.',
  }
);
