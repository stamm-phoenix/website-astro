import { app } from '@azure/functions';
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
} from './endpoints/intern-pflege-sammelbestellungen';
import GetGruppenstundenEndpoint from './endpoints/gruppenstunden';
import GetVorstandEndpoint from './endpoints/vorstand';
import GetLeitendeEndpoint from './endpoints/leitende';
import { GetLeitendeImage } from './endpoints/image';
import GetAktionenEndpoint from './endpoints/aktionen';
import GetAktionenIcsEndpoint from './endpoints/aktionen-ics';
import GetLeitendeIcsEndpoint from './endpoints/leitende-ics';
import { GetBlog, GetBlogPost, GetBlogImage } from './endpoints/blog';
import GetDownloadFilesEndpoint from './endpoints/download-files';
import GetDownloadFileImageEndpoint from './endpoints/download-file-image';
import GetDownloadFileEndpoint from './endpoints/download-file';
import GetQuestionsAndAnswersEndpoint from './endpoints/qa';
import { QuestionsCollection, QuestionItem } from './endpoints/intern-pflege-qa';
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
import GetInternAktionenEndpoint from './endpoints/intern-aktionen';
import GetInternAktionEndpoint from './endpoints/intern-aktion';
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
  DownloadsCollection,
  DownloadUpload,
  DownloadItem,
} from './endpoints/intern-pflege-downloads';

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

app.http('aktionenIcs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'aktionen.ics',
  handler: GetAktionenIcsEndpoint,
});

app.http('leitendeIcs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'leitende.ics',
  handler: GetLeitendeIcsEndpoint,
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
  handler: DownloadUpload,
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
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: SammelStaffCampaign,
});
app.http('sammelStaffOrder', {
  route: 'intern/pflege/sammelbestellungen/orders/{id}',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: SammelStaffOrder,
});
app.http('sammelStaffMessage', {
  route: 'intern/pflege/sammelbestellungen/orders/{id}/message',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: SammelStaffMessage,
});
