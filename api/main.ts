import { ProtokollCutoverStatus } from './endpoints/protokoll-cutover-status';
import {
  AufgabenCollection,
  AufgabenUsers,
  AufgabenAssignment,
  AufgabeItem,
  AufgabenProject,
  AufgabenTemplate,
  AufgabenChecklist,
  AufgabenRecognize,
  AufgabenDecision,
} from './endpoints/intern-pflege-aufgaben';
import { app } from '@azure/functions';
import './endpoints/ics-routes';
import { AbstimmungAbstimmen, AbstimmungAnsehen } from './endpoints/abstimmungen';
import {
  AbstimmungEinladung,
  AbstimmungErinnerung,
  AbstimmungItem,
  AbstimmungMails,
  AbstimmungStimme,
  AbstimmungenCollection,
} from './endpoints/intern-pflege-abstimmungen';
import { GetRoles } from './endpoints/get-roles';
import {
  SammelStaffPayment,
  SammelStaffPaymentPersons,
} from './endpoints/intern-sammelbestellung-payments';
import {
  SammelCampaignLookup,
  SammelProductLookup,
  SammelRequestLink,
  SammelOrderLookup,
  SammelOrderSave,
} from './endpoints/sammelbestellungen';
import {
  SammelStaffCampaigns,
  SammelStaffCampaign,
  SammelStaffOrder,
  SammelStaffMessage,
  SammelStaffProduct,
  SammelStaffItem,
  SammelStaffInvite,
} from './endpoints/intern-pflege-sammelbestellungen';
import GetGruppenstundenEndpoint from './endpoints/gruppenstunden';
import GetVorstandEndpoint from './endpoints/vorstand';
import GetLeitendeEndpoint from './endpoints/leitende';
import { GetLeitendeImage } from './endpoints/image';
import GetAktionenEndpoint from './endpoints/aktionen';
import { GetBlog, GetBlogPost, GetBlogImage } from './endpoints/blog';
import GetDownloadFilesEndpoint from './endpoints/download-files';
import GetDownloadFileImageEndpoint from './endpoints/download-file-image';
import GetDownloadFileEndpoint from './endpoints/download-file';
import GetQuestionsAndAnswersEndpoint from './endpoints/qa';
import { QuestionsCollection, QuestionItem } from './endpoints/intern-pflege-qa';
import { PersonItem, PersonenCollection } from './endpoints/intern-pflege-personen';
import { Ich } from './endpoints/intern-ich';
import { StaffFavorites } from './endpoints/intern-favoriten';
import { StaffChangelog } from './endpoints/intern-neuigkeiten';
import { StaffRecent } from './endpoints/intern-zuletzt';
import { StaffSettings } from './endpoints/intern-einstellungen';
import {
  AnwesenheitCancelled,
  AnwesenheitChild,
  AnwesenheitGuest,
  AnwesenheitGuests,
  AnwesenheitNotes,
  GetAnwesenheit,
  GetAnwesenheitTermin,
} from './endpoints/intern-anwesenheit';
import { AktionenCollection, AktionItem } from './endpoints/intern-pflege-aktionen';
import AktionZuschuss from './endpoints/intern-pflege-aktion-zuschuss';
import AktionArt from './endpoints/intern-pflege-aktion-art';
import GetInstagramEndpoint, { GetInstagramImage, GetInstagramVideo } from './endpoints/instagram';
import GetNikolausSlotsEndpoint from './endpoints/nikolaus-slots';
import CreateNikolausBookingEndpoint from './endpoints/nikolaus-booking-create';
import LookupNikolausBookingEndpoint from './endpoints/nikolaus-manage-lookup';
import GetNikolausProgressEndpoint from './endpoints/nikolaus-manage-progress';
import ConfirmNikolausBookingEndpoint from './endpoints/nikolaus-manage-confirm';
import CancelNikolausBookingEndpoint from './endpoints/nikolaus-manage-cancel';
import UpdateNikolausBookingEndpoint from './endpoints/nikolaus-manage-update';
import RescheduleNikolausBookingEndpoint from './endpoints/nikolaus-manage-reschedule';
import ResendNikolausLinkEndpoint from './endpoints/nikolaus-manage-resend-link';
import GeocodeNikolausAddressEndpoint from './endpoints/nikolaus-geocode';
import { KarteKachel, KarteQuelle } from './endpoints/karte-kachel';
import { AltchaChallenge } from './endpoints/altcha';
import { KontaktSend } from './endpoints/kontakt';
import { ProblemMeldungSend } from './endpoints/problemmeldung';
import {
  ProblemMeldungAssess,
  ProblemMeldungDiscard,
  ProblemMeldungGithub,
  ProblemMeldungItem,
  ProblemMeldungenCollection,
} from './endpoints/intern-pflege-problemmeldungen';
import GetInternNikolausBookingsEndpoint from './endpoints/intern-nikolaus-bookings';
import NikolausMessageEndpoint from './endpoints/intern-nikolaus-message';
import NikolausRescheduleEndpoint from './endpoints/intern-nikolaus-reschedule';
import NikolausCancelEndpoint from './endpoints/intern-nikolaus-cancel';
import GetInternNikolausDispoEndpoint, {
  NikolausDispoRoutes,
  NikolausDispoSave,
} from './endpoints/intern-nikolaus-dispo';
import GetInternNikolausFahrtEndpoint, {
  NikolausFahrtVisit,
} from './endpoints/intern-nikolaus-fahrt';
import {
  NikolausBookingTagsEndpoint,
  NikolausEinteilung,
  NikolausEinteilungSaveEndpoint,
  NikolausHelfende,
  NikolausHelfendeCollectionEndpoint,
  NikolausHelfendeItemEndpoint,
} from './endpoints/intern-nikolaus-helfende';
import { NikolausStufen, NikolausStufenDecisionEndpoint } from './endpoints/intern-nikolaus-stufen';
import {
  NikolausStatus,
  NikolausSteuerungDeleteEndpoint,
  NikolausSteuerungEndpoint,
  NikolausSteuerungSaveEndpoint,
} from './endpoints/intern-nikolaus-steuerung';
import {
  EssensplanungEinstellungenEndpoint,
  EssensplanungListeEintragEndpoint,
  EssensplanungListeEndpoint,
  EssensplanungSteuerungEndpoint,
} from './endpoints/intern-essensplanung-steuerung';
import {
  EssensplanungAnlegen,
  EssensplanungBeitreten,
  EssensplanungBeitrittAnsehen,
  EssensplanungBestaetigen,
  EssensplanungIch,
  EssensplanungLinks,
  EssensplanungMahlzeit,
  EssensplanungMahlzeiten,
  EssensplanungMeine,
  EssensplanungMitglied,
  EssensplanungMitgliedLink,
  EssensplanungMitglieder,
  EssensplanungPlanung,
  EssensplanungStand,
  EssensplanungTag,
  EssensplanungTage,
  EssensplanungKatalog,
  EssensplanungZutaten,
  EssensplanungZutat,
  EssensplanungGerichte,
  EssensplanungGericht,
  EssensplanungGerichtZutaten,
  EssensplanungGerichtZutat,
  EssensplanungEinplanungen,
  EssensplanungEinplanung,
  EssensplanungGruppen,
  EssensplanungGruppe,
  EssensplanungTeilnehmendeListe,
  EssensplanungTeilnehmende,
  EssensplanungMahlzeitGruppe,
} from './endpoints/essensplanung';
import {
  EssensplanungBestand,
  EssensplanungBestandListe,
  EssensplanungGeschaeft,
  EssensplanungGeschaefte,
  EssensplanungZusatzbedarf,
  EssensplanungZusatzbedarfListe,
  EssensplanungZutatGeschaeft,
} from './endpoints/essensplanung-einkauf';
import { EssensplanungEinplanungStatus } from './endpoints/essensplanung-kochen';
import {
  EssensplanungEinkaeufe,
  EssensplanungEinkauf,
  EssensplanungEinkaufAbhaken,
  EssensplanungEinkaufPosten,
  EssensplanungEinkaufRegel,
  EssensplanungEinkaufVerschieben,
  EssensplanungEinkaufZurueckholen,
} from './endpoints/essensplanung-einkaeufe';
import {
  EssensplanungPackEintrag,
  EssensplanungPackliste,
  EssensplanungPackWerkzeug,
} from './endpoints/essensplanung-packliste';
import {
  EssensplanungGerichtZutatenSammel,
  EssensplanungKiPruefen,
  EssensplanungKiRezept,
  EssensplanungKiUmrechnung,
} from './endpoints/essensplanung-ki';
import {
  EditorCollection,
  EditorItem,
  EditorReview,
  EditorSperre,
  EditorVersand,
  GetEditorLive,
  GetEditorOverview,
  GetEditorPdf,
  GetEditorPersonen,
  GetEditorAufgaben,
  EditorAufgabe,
  GetEditorProtokoll,
  GetEditorRevision,
  GetEditorRevisions,
} from './endpoints/intern-protokoll-editor';
import GetNikolausSettingsEndpoint from './endpoints/nikolaus-settings';
import GetInternAktionenEndpoint from './endpoints/intern-aktionen';
import GetInternAktionEndpoint from './endpoints/intern-aktion';
import GetInternAktionBeitraegeEndpoint from './endpoints/intern-aktion-beitraege';
import GetInternAbrechnungKostenstellenEndpoint from './endpoints/intern-abrechnung-kostenstellen';
import { AbrechnungEingabeHandler } from './endpoints/intern-abrechnung-eingabe';
import { AbrechnungZeitplanHandler } from './endpoints/intern-abrechnung-zeitplan';
import GetInternAbrechnungEndpoint from './endpoints/intern-abrechnung';
import PostInternAbrechnungKjrListeEndpoint from './endpoints/intern-abrechnung-kjr-liste';
import GetInternAbrechnungBelegBildEndpoint, {
  GetInternAbrechnungBelegVorschau,
} from './endpoints/intern-abrechnung-beleg-bild';
import GetInternBeitraegeEndpoint from './endpoints/intern-beitraege';
import GetInternBeitraegeMeineEndpoint from './endpoints/intern-beitraege-meine';
import GetInternKostenstellenSummenEndpoint from './endpoints/intern-kostenstellen-summen';
import GetInternMitgliederEndpoint from './endpoints/intern-mitglieder';
import {
  GruppenstundenCollection,
  GruppenstundeItem,
} from './endpoints/intern-pflege-gruppenstunden';
import {
  LeitendeCollection,
  LeitendeItem,
  LeitendePhoto,
} from './endpoints/intern-pflege-leitende';
import {
  BlogCollection,
  BlogItem,
  BlogImages,
  BlogImageItem,
} from './endpoints/intern-pflege-blog';
import {
  FotosFolder,
  FotosFile,
  FotosNote,
  FotosTarget,
  FotosUpload,
} from './endpoints/intern-fotos';
import {
  DownloadsCollection,
  DownloadUploadStart,
  DownloadUploadPart,
  DownloadUploadComplete,
  DownloadItem,
} from './endpoints/intern-pflege-downloads';
import {
  BelegeCollection,
  BelegItem,
  BelegCampflow,
  BelegeCampflow,
  BelegPhoto,
  BelegPruefung,
  BelegRolle,
} from './endpoints/intern-pflege-belege';
import {
  ProtokolleCollection,
  ProtokollItem,
  ProtokollPdf,
  ProtokollTermin,
  ProtokollVersand,
  ProtokollVorschau,
} from './endpoints/intern-pflege-protokolle';

// `rolesSource` of staticwebapp.config.json, called by Static Web Apps after each login
app.http('getRoles', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'GetRoles',
  handler: GetRoles,
});

app.http('gruppenstunden', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetGruppenstundenEndpoint,
});

app.http('vorstand', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetVorstandEndpoint,
});

app.http('leitende', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetLeitendeEndpoint,
});

app.http('aktionen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetAktionenEndpoint,
});

app.http('image', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'leitende/{id}/image',
  handler: GetLeitendeImage,
});

app.http('blog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetBlog,
});

app.http('blogPost', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'blog/{id}',
  handler: GetBlogPost,
});

app.http('blogImage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'blog/{id}/bilder/{file}',
  handler: GetBlogImage,
});

app.http('downloads', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetDownloadFilesEndpoint,
});

app.http('qa', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetQuestionsAndAnswersEndpoint,
});

app.http('downloadImage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'downloads/{id}/image/{size}',
  handler: GetDownloadFileImageEndpoint,
});

app.http('downloadFile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'downloads/{id}/file',
  handler: GetDownloadFileEndpoint,
});

app.http('instagram', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetInstagramEndpoint,
});

app.http('instagramImage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'instagram/{id}/image',
  handler: GetInstagramImage,
});

app.http('instagramVideo', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'instagram/{id}/video',
  handler: GetInstagramVideo,
});

app.http('nikolausSettings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'nikolaus/settings',
  handler: GetNikolausSettingsEndpoint,
});

app.http('nikolausSlots', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'nikolaus/slots',
  handler: GetNikolausSlotsEndpoint,
});

app.http('nikolausBookingCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/bookings',
  handler: CreateNikolausBookingEndpoint,
});

app.http('nikolausManageLookup', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/lookup',
  handler: LookupNikolausBookingEndpoint,
});

app.http('nikolausManageProgress', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/progress',
  handler: GetNikolausProgressEndpoint,
});

app.http('nikolausManageConfirm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/confirm',
  handler: ConfirmNikolausBookingEndpoint,
});

app.http('nikolausManageCancel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/cancel',
  handler: CancelNikolausBookingEndpoint,
});

app.http('nikolausManageUpdate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/update',
  handler: UpdateNikolausBookingEndpoint,
});

app.http('nikolausManageReschedule', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/reschedule',
  handler: RescheduleNikolausBookingEndpoint,
});

app.http('nikolausManageResendLink', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/resend-link',
  handler: ResendNikolausLinkEndpoint,
});

app.http('nikolausGeocode', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/geocode',
  handler: GeocodeNikolausAddressEndpoint,
});

// Map tiles of the Nikolaus maps and their copyright notices from Azure Maps, so browsers load
// them from our own origin
app.http('karteKachel', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'karte/{style}/{z}/{x}/{y}',
  handler: KarteKachel,
});

app.http('karteQuelle', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'karte-quelle/{style}/{z}',
  handler: KarteQuelle,
});

// Proof of work for the public forms (Kontakt, Nikolaus booking, Sammelbestellung link request)
app.http('altchaChallenge', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'altcha/challenge',
  handler: AltchaChallenge,
});

app.http('kontaktSend', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'kontakt',
  handler: KontaktSend,
});

app.http('problemMeldungSend', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'problemmeldung',
  handler: ProblemMeldungSend,
});

// Leitendenbereich: only reachable for logged-in members of our tenant
// (see staticwebapp.config.json and lib/staff-auth.ts)
app.http('internNikolausBookings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/bookings',
  handler: GetInternNikolausBookingsEndpoint,
});

app.http('internAktionen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/aktionen',
  handler: GetInternAktionenEndpoint,
});

app.http('internAktion', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/aktionen/{id}',
  handler: GetInternAktionEndpoint,
});

app.http('internAktionBeitraege', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/aktionen/{id}/beitraege',
  handler: GetInternAktionBeitraegeEndpoint,
});

// Not under `intern/abrechnung/`: the host sends that path to `intern/abrechnung/{id}`, whatever
// the order of registration
app.http('internKostenstellen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/kostenstellen',
  handler: GetInternAbrechnungKostenstellenEndpoint,
});

app.http('internAbrechnungEingabe', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/{id}/eingaben',
  handler: AbrechnungEingabeHandler,
});

app.http('internAbrechnungZeitplan', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/{id}/zeitplan',
  handler: AbrechnungZeitplanHandler,
});

app.http('internAbrechnung', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/{id}',
  handler: GetInternAbrechnungEndpoint,
});

app.http('internAbrechnungBelegBild', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/belege/{nummer}/bild',
  handler: GetInternAbrechnungBelegBildEndpoint,
});

app.http('internAbrechnungBelegVorschau', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/belege/{nummer}/vorschau',
  handler: GetInternAbrechnungBelegVorschau,
});

app.http('internAbrechnungKjrListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/{id}/kjr-liste',
  handler: PostInternAbrechnungKjrListeEndpoint,
});

app.http('internBeitraege', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/beitraege',
  handler: GetInternBeitraegeEndpoint,
});

app.http('internBeitraegeMeine', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/beitraege/meine',
  handler: GetInternBeitraegeMeineEndpoint,
});

app.http('internKostenstellenSummen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/kostenstellen/summen',
  handler: GetInternKostenstellenSummenEndpoint,
});

app.http('internMitglieder', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/mitglieder',
  handler: GetInternMitgliederEndpoint,
});

// Edit modules of the Leitendenbereich (write to SharePoint)
app.http('internPflegeQuestions', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/qa',
  handler: QuestionsCollection,
});

app.http('internPflegeQuestion', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/qa/{id}',
  handler: QuestionItem,
});

app.http('internPflegeProblemmeldungen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/problemmeldungen',
  handler: ProblemMeldungenCollection,
});

app.http('internPflegeProblemmeldung', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'intern/pflege/problemmeldungen/{id}',
  handler: ProblemMeldungItem,
});

app.http('internPflegeProblemmeldungVerwerfen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/problemmeldungen/{id}/verwerfen',
  handler: ProblemMeldungDiscard,
});

app.http('internPflegeProblemmeldungGithub', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/problemmeldungen/{id}/github',
  handler: ProblemMeldungGithub,
});

app.http('internPflegeProblemmeldungBewerten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/problemmeldungen/{id}/bewerten',
  handler: ProblemMeldungAssess,
});

app.http('internAnwesenheit', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/anwesenheit',
  handler: GetAnwesenheit,
});

app.http('internAnwesenheitTermin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/anwesenheit/{stufe}/{datum}',
  handler: GetAnwesenheitTermin,
});

app.http('internPflegeAnwesenheitNotes', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/anwesenheit/{stufe}/{datum}',
  handler: AnwesenheitNotes,
});

app.http('internPflegeAnwesenheitCancelled', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/anwesenheit/{stufe}/{datum}/ausgefallen',
  handler: AnwesenheitCancelled,
});

app.http('internPflegeAnwesenheitChild', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/anwesenheit/{stufe}/{datum}/kinder/{id}',
  handler: AnwesenheitChild,
});

app.http('internPflegeAnwesenheitGuests', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/anwesenheit/{stufe}/{datum}/gaeste',
  handler: AnwesenheitGuests,
});

app.http('internPflegeAnwesenheitGuest', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/anwesenheit/{stufe}/{datum}/gaeste/{id}',
  handler: AnwesenheitGuest,
});

app.http('internProtokollEditor', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor',
  handler: GetEditorOverview,
});

app.http('internProtokollEditorPersonen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor-personen',
  handler: GetEditorPersonen,
});

app.http('internProtokollEditorAufgaben', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor-aufgaben',
  handler: GetEditorAufgaben,
});

app.http('internPflegeProtokollEditorAufgabe', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor-aufgaben/{id}',
  handler: EditorAufgabe,
});

app.http('internProtokollEditorItem', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}',
  handler: GetEditorProtokoll,
});

app.http('internProtokollEditorLive', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/live',
  handler: GetEditorLive,
});

app.http('internProtokollEditorVersionen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/versionen',
  handler: GetEditorRevisions,
});

app.http('internProtokollEditorVersion', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/versionen/{revisionId}',
  handler: GetEditorRevision,
});

app.http('internProtokollEditorPdf', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/protokoll-editor/{id}/pdf',
  handler: GetEditorPdf,
});

app.http('internPflegeProtokollEditor', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor',
  handler: EditorCollection,
});

app.http('internPflegeProtokollEditorItem', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}',
  handler: EditorItem,
});

app.http('internPflegeProtokollEditorSperre', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}/sperre',
  handler: EditorSperre,
});

app.http('internPflegeAktionZuschuss', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aktionen-zuschuss/{id}',
  handler: AktionZuschuss,
});

app.http('internPflegeAktionArt', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aktionen-art/{id}',
  handler: AktionArt,
});

app.http('internPflegePersonen', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/personen',
  handler: PersonenCollection,
});

app.http('internPflegePerson', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/personen/{id}',
  handler: PersonItem,
});

app.http('internIch', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/ich',
  handler: Ich,
});

app.http('internFavoriten', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/favoriten',
  handler: StaffFavorites,
});

app.http('internZuletzt', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/zuletzt',
  handler: StaffRecent,
});

app.http('internNeuigkeiten', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/neuigkeiten',
  handler: StaffChangelog,
});

app.http('internEinstellungen', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/einstellungen',
  handler: StaffSettings,
});

app.http('internPflegeProtokollEditorReview', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}/review',
  handler: EditorReview,
});

app.http('internPflegeProtokollEditorVersand', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor/{id}/versand',
  handler: EditorVersand,
});

app.http('internPflegeAktionen', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aktionen',
  handler: AktionenCollection,
});

app.http('internPflegeAktion', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aktionen/{id}',
  handler: AktionItem,
});

app.http('internPflegeGruppenstunden', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/gruppenstunden',
  handler: GruppenstundenCollection,
});

app.http('internPflegeGruppenstunde', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/gruppenstunden/{id}',
  handler: GruppenstundeItem,
});

app.http('internPflegeLeitende', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/leitende',
  handler: LeitendeCollection,
});

app.http('internPflegeLeitendeItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/leitende/{id}',
  handler: LeitendeItem,
});

app.http('internPflegeLeitendeFoto', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/leitende/{id}/foto',
  handler: LeitendePhoto,
});

app.http('internPflegeBelege', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege',
  handler: BelegeCollection,
});

// Registered before `belege/{id}`, which would otherwise match `pruefung`
app.http('internPflegeBelegPruefung', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/pruefung',
  handler: BelegPruefung,
});

// Registered before `belege/{id}` as well
app.http('internPflegeBelegeCampflow', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/campflow',
  handler: BelegeCampflow,
});

app.http('internPflegeBelegRolle', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/rolle',
  handler: BelegRolle,
});

app.http('internPflegeBelegItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}',
  handler: BelegItem,
});

app.http('internPflegeBelegFoto', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}/foto',
  handler: BelegPhoto,
});

app.http('internPflegeBelegCampflow', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}/campflow',
  handler: BelegCampflow,
});

app.http('internPflegeProtokolle', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle',
  handler: ProtokolleCollection,
});

app.http('internPflegeProtokollItem', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}',
  handler: ProtokollItem,
});

app.http('internPflegeProtokollPdf', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/pdf',
  handler: ProtokollPdf,
});

app.http('internPflegeProtokollVorschau', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/vorschau',
  handler: ProtokollVorschau,
});

app.http('internPflegeProtokollTermin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/termin',
  handler: ProtokollTermin,
});

app.http('internPflegeProtokollVersand', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/versand',
  handler: ProtokollVersand,
});

app.http('internFotosOrdner', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/fotos/ordner',
  handler: FotosFolder,
});

app.http('internFotosDatei', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/fotos/dateien/{id}',
  handler: FotosFile,
});

app.http('internFotosZiel', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/fotos/ziel',
  handler: FotosTarget,
});

app.http('internFotosUpload', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/fotos/upload',
  handler: FotosUpload,
});

app.http('internFotosBenachrichtigung', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/fotos/benachrichtigung',
  handler: FotosNote,
});

app.http('internPflegeDownloads', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/downloads',
  handler: DownloadsCollection,
});

app.http('internPflegeDownloadUpload', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/downloads/upload',
  handler: DownloadUploadStart,
});

app.http('internPflegeDownloadUploadPart', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/downloads/upload/{uploadId}/{index}',
  handler: DownloadUploadPart,
});

app.http('internPflegeDownloadUploadComplete', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/downloads/upload/{uploadId}',
  handler: DownloadUploadComplete,
});

app.http('internPflegeDownloadItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/downloads/{id}',
  handler: DownloadItem,
});

app.http('internPflegeBlog', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/blog',
  handler: BlogCollection,
});

app.http('internPflegeBlogItem', {
  methods: ['GET', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/blog/{id}',
  handler: BlogItem,
});

app.http('internPflegeBlogBilder', {
  methods: ['PUT', 'PATCH'],
  authLevel: 'anonymous',
  route: 'intern/pflege/blog/{id}/bilder',
  handler: BlogImages,
});

app.http('internPflegeBlogBild', {
  methods: ['GET', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/blog/{id}/bilder/{file}',
  handler: BlogImageItem,
});

app.http('internNikolausMessage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/bookings/{id}/message',
  handler: NikolausMessageEndpoint,
});

app.http('internNikolausReschedule', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/bookings/{id}/reschedule',
  handler: NikolausRescheduleEndpoint,
});

app.http('internNikolausCancel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/bookings/{id}/cancel',
  handler: NikolausCancelEndpoint,
});

app.http('internNikolausDispo', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/dispo',
  handler: GetInternNikolausDispoEndpoint,
});

app.http('internNikolausDispoRoutes', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/dispo/routes',
  handler: NikolausDispoRoutes,
});

app.http('internPflegeNikolausDispo', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-dispo',
  handler: NikolausDispoSave,
});

app.http('internNikolausFahrt', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/fahrt',
  handler: GetInternNikolausFahrtEndpoint,
});

app.http('internPflegeNikolausFahrt', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-fahrt',
  handler: NikolausFahrtVisit,
});

app.http('internNikolausHelfende', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/helfende',
  handler: NikolausHelfende,
});

app.http('internNikolausEinteilung', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/einteilung',
  handler: NikolausEinteilung,
});

app.http('internPflegeNikolausHelfende', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-helfende',
  handler: NikolausHelfendeCollectionEndpoint,
});

app.http('internPflegeNikolausHelfendeItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-helfende/{id}',
  handler: NikolausHelfendeItemEndpoint,
});

app.http('internPflegeNikolausBookingTags', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-bookings/{id}/tags',
  handler: NikolausBookingTagsEndpoint,
});

app.http('internPflegeNikolausEinteilung', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-einteilung',
  handler: NikolausEinteilungSaveEndpoint,
});

app.http('internNikolausStufen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/stufen-abgleich',
  handler: NikolausStufen,
});

app.http('internPflegeNikolausStufen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-stufen-abgleich',
  handler: NikolausStufenDecisionEndpoint,
});

app.http('internNikolausStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/status',
  handler: NikolausStatus,
});

app.http('internNikolausSteuerung', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/steuerung',
  handler: NikolausSteuerungEndpoint,
});

app.http('internPflegeNikolausSteuerung', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-steuerung',
  handler: NikolausSteuerungSaveEndpoint,
});

app.http('internPflegeNikolausSteuerungDelete', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/nikolaus-steuerung/loeschen',
  handler: NikolausSteuerungDeleteEndpoint,
});

// Essensplanung: public, access only by the token of a link (docs/essensplanung.md).
app.http('essensplanungAnlegen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/anlegen',
  handler: EssensplanungAnlegen,
});

app.http('essensplanungBestaetigen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/anlegen/bestaetigen',
  handler: EssensplanungBestaetigen,
});

app.http('essensplanungMeine', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/meine',
  handler: EssensplanungMeine,
});

app.http('essensplanungBeitrittAnsehen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/beitritt/ansehen',
  handler: EssensplanungBeitrittAnsehen,
});

app.http('essensplanungBeitreten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/beitritt',
  handler: EssensplanungBeitreten,
});

app.http('essensplanungPlanung', {
  methods: ['GET', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung',
  handler: EssensplanungPlanung,
});

app.http('essensplanungStand', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/stand',
  handler: EssensplanungStand,
});

app.http('essensplanungIch', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/ich',
  handler: EssensplanungIch,
});

app.http('essensplanungLinks', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/links',
  handler: EssensplanungLinks,
});

app.http('essensplanungMitglieder', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mitglieder',
  handler: EssensplanungMitglieder,
});

app.http('essensplanungMitglied', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mitglieder/{id}',
  handler: EssensplanungMitglied,
});

app.http('essensplanungMitgliedLink', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mitglieder/{id}/link',
  handler: EssensplanungMitgliedLink,
});

app.http('essensplanungTage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/tage',
  handler: EssensplanungTage,
});

app.http('essensplanungTag', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/tage/{id}',
  handler: EssensplanungTag,
});

app.http('essensplanungMahlzeiten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mahlzeiten',
  handler: EssensplanungMahlzeiten,
});

app.http('essensplanungMahlzeit', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mahlzeiten/{id}',
  handler: EssensplanungMahlzeit,
});

app.http('essensplanungKatalog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/katalog',
  handler: EssensplanungKatalog,
});

app.http('essensplanungZutaten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zutaten',
  handler: EssensplanungZutaten,
});

app.http('essensplanungZutat', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zutaten/{id}',
  handler: EssensplanungZutat,
});

app.http('essensplanungGerichte', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte',
  handler: EssensplanungGerichte,
});

app.http('essensplanungGericht', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}',
  handler: EssensplanungGericht,
});

app.http('essensplanungGerichtZutaten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/zutaten',
  handler: EssensplanungGerichtZutaten,
});

app.http('essensplanungGerichtZutat', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gericht-zutaten/{id}',
  handler: EssensplanungGerichtZutat,
});

app.http('essensplanungGerichtZutatenSammel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/zutaten/sammel',
  handler: EssensplanungGerichtZutatenSammel,
});

app.http('essensplanungKiPruefen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/ki/pruefen',
  handler: EssensplanungKiPruefen,
});

app.http('essensplanungKiRezept', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/ki/rezept',
  handler: EssensplanungKiRezept,
});

app.http('essensplanungKiUmrechnung', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/ki/umrechnung',
  handler: EssensplanungKiUmrechnung,
});

app.http('essensplanungEinplanungen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einplanungen',
  handler: EssensplanungEinplanungen,
});

app.http('essensplanungGruppen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gruppen',
  handler: EssensplanungGruppen,
});

app.http('essensplanungGruppe', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gruppen/{id}',
  handler: EssensplanungGruppe,
});

app.http('essensplanungGeschaefte', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/geschaefte',
  handler: EssensplanungGeschaefte,
});

app.http('essensplanungGeschaeft', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/geschaefte/{id}',
  handler: EssensplanungGeschaeft,
});

app.http('essensplanungZutatGeschaeft', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zutaten/{id}/geschaeft',
  handler: EssensplanungZutatGeschaeft,
});

app.http('essensplanungBestandListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/bestand',
  handler: EssensplanungBestandListe,
});

app.http('essensplanungBestand', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/bestand/{id}',
  handler: EssensplanungBestand,
});

app.http('essensplanungZusatzbedarfListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zusatzbedarf',
  handler: EssensplanungZusatzbedarfListe,
});

app.http('essensplanungZusatzbedarf', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/zusatzbedarf/{id}',
  handler: EssensplanungZusatzbedarf,
});

app.http('essensplanungPackliste', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/packliste',
  handler: EssensplanungPackliste,
});

app.http('essensplanungPackWerkzeug', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/packliste/werkzeug',
  handler: EssensplanungPackWerkzeug,
});

app.http('essensplanungPackEintrag', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/packliste/{id}',
  handler: EssensplanungPackEintrag,
});

app.http('essensplanungTeilnehmendeListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/teilnehmende',
  handler: EssensplanungTeilnehmendeListe,
});

app.http('essensplanungTeilnehmende', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/teilnehmende/{id}',
  handler: EssensplanungTeilnehmende,
});

app.http('essensplanungMahlzeitGruppe', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mahlzeiten/{id}/gruppen',
  handler: EssensplanungMahlzeitGruppe,
});

app.http('essensplanungEinplanung', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einplanungen/{id}',
  handler: EssensplanungEinplanung,
});

app.http('essensplanungEinplanungStatus', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einplanungen/{id}/status',
  handler: EssensplanungEinplanungStatus,
});

app.http('essensplanungEinkaeufe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe',
  handler: EssensplanungEinkaeufe,
});

app.http('essensplanungEinkauf', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}',
  handler: EssensplanungEinkauf,
});

app.http('essensplanungEinkaufAbhaken', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/posten',
  handler: EssensplanungEinkaufAbhaken,
});

app.http('essensplanungEinkaufRegel', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/regeln',
  handler: EssensplanungEinkaufRegel,
});

app.http('essensplanungEinkaufVerschieben', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/verschieben',
  handler: EssensplanungEinkaufVerschieben,
});

app.http('essensplanungEinkaufZurueckholen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/zurueckholen',
  handler: EssensplanungEinkaufZurueckholen,
});

app.http('essensplanungEinkaufPosten', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkauf-posten/{id}',
  handler: EssensplanungEinkaufPosten,
});

// Essensplanung: the Steuerung for the teams Admin and Vorstand (docs/essensplanung.md).
app.http('internEssensplanungSteuerung', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/essensplanung/steuerung',
  handler: EssensplanungSteuerungEndpoint,
});

app.http('internPflegeEssensplanungEinstellungen', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung/einstellungen',
  handler: EssensplanungEinstellungenEndpoint,
});

app.http('internPflegeEssensplanungListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung/{liste}',
  handler: EssensplanungListeEndpoint,
});

app.http('internPflegeEssensplanungListeEintrag', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung/{liste}/{id}',
  handler: EssensplanungListeEintragEndpoint,
});

// Sammelbestellungen: shared invitation and private order links; staff writes require Entra ID.
app.http('sammelCampaignLookup', {
  route: 'sammelbestellungen/campaign',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelCampaignLookup,
});
app.http('sammelRequestLink', {
  route: 'sammelbestellungen/request-link',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelRequestLink,
});
app.http('sammelOrderLookup', {
  route: 'sammelbestellungen/order',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelOrderLookup,
});
app.http('sammelOrderSave', {
  route: 'sammelbestellungen/order',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: SammelOrderSave,
});
app.http('sammelProductLookup', {
  route: 'sammelbestellungen/product',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelProductLookup,
});
app.http('sammelStaffCampaigns', {
  route: 'intern/pflege/sammelbestellungen',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: SammelStaffCampaigns,
});
app.http('sammelStaffCampaign', {
  route: 'intern/pflege/sammelbestellungen/{id}',
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  handler: SammelStaffCampaign,
});
app.http('sammelStaffOrder', {
  route: 'intern/pflege/sammelbestellungen/orders/{id}',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: SammelStaffOrder,
});

app.http('sammelStaffPayment', {
  route: 'intern/pflege/sammelbestellungen/orders/{id}/payment',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: SammelStaffPayment,
});

app.http('sammelStaffPaymentPersons', {
  route: 'intern/pflege/sammelbestellungen/orders/{id}/payment/persons',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: SammelStaffPaymentPersons,
});
app.http('sammelStaffMessage', {
  route: 'intern/pflege/sammelbestellungen/orders/{id}/message',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelStaffMessage,
});

app.http('sammelStaffProduct', {
  route: 'intern/pflege/sammelbestellungen/product',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelStaffProduct,
});

app.http('sammelStaffItem', {
  route: 'intern/pflege/sammelbestellungen/orders/{id}/item',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: SammelStaffItem,
});

app.http('sammelStaffInvite', {
  route: 'intern/pflege/sammelbestellungen/{id}/invite',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelStaffInvite,
});

// Abstimmungen: links with a token work without login; staff routes require Entra ID.
app.http('abstimmungAnsehen', {
  route: 'abstimmungen/ansehen',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungAnsehen,
});
app.http('abstimmungAbstimmen', {
  route: 'abstimmungen/stimme',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: AbstimmungAbstimmen,
});
app.http('internPflegeAbstimmungen', {
  route: 'intern/pflege/abstimmungen',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: AbstimmungenCollection,
});
app.http('internPflegeAbstimmung', {
  route: 'intern/pflege/abstimmungen/{id}',
  methods: ['GET', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  handler: AbstimmungItem,
});
app.http('internPflegeAbstimmungStimme', {
  route: 'intern/pflege/abstimmungen/{id}/stimme',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: AbstimmungStimme,
});
app.http('internPflegeAbstimmungEinladung', {
  route: 'intern/pflege/abstimmungen/{id}/einladung',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungEinladung,
});
app.http('internPflegeAbstimmungErinnerung', {
  route: 'intern/pflege/abstimmungen/{id}/erinnerung',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungErinnerung,
});
app.http('internPflegeAbstimmungMails', {
  route: 'intern/pflege/abstimmungen/{id}/mails',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungMails,
});

app.http('internPflegeAufgaben', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben',
  handler: AufgabenCollection,
});

app.http('internPflegeAufgabenBenutzer', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/benutzer',
  handler: AufgabenUsers,
});

app.http('internPflegeAufgabe', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/{id:int}',
  handler: AufgabeItem,
});

app.http('internPflegeAufgabenProjekte', {
  methods: ['POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/projekte/{id:int?}',
  handler: AufgabenProject,
});

app.http('internPflegeAufgabenVorlagen', {
  methods: ['POST', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/vorlagen/{id:int?}',
  handler: AufgabenTemplate,
});

app.http('internPflegeAufgabenCheckliste', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/checkliste',
  handler: AufgabenChecklist,
});

app.http('internPflegeAufgabenErkennen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/protokolle/{id}/erkennen',
  handler: AufgabenRecognize,
});

app.http('internPflegeAufgabenEntscheidung', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/{id:int}/entscheidung',
  handler: AufgabenDecision,
});

app.http('internPflegeAufgabenZuordnung', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/aufgaben/{id:int}/zuordnung',
  handler: AufgabenAssignment,
});

app.http('protokollCutoverStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'protokoll-cutover-status',
  handler: ProtokollCutoverStatus,
});
