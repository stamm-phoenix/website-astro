import { app } from '@azure/functions';
import GetGruppenstundenEndpoint from './endpoints/gruppenstunden';
import GetVorstandEndpoint from './endpoints/vorstand';
import GetLeitendeEndpoint from './endpoints/leitende';
import { GetLeitendeImage, GetBlogImage } from './endpoints/image';
import GetAktionenEndpoint from './endpoints/aktionen';
import GetAktionenIcsEndpoint from './endpoints/aktionen-ics';
import GetLeitendeIcsEndpoint from './endpoints/leitende-ics';
import GetBlogEndpoint from './endpoints/blog';
import GetDownloadFilesEndpoint from './endpoints/download-files';
import GetDownloadFileImageEndpoint from './endpoints/download-file-image';
import GetDownloadFileEndpoint from './endpoints/download-file';
import GetNikolausSlotsEndpoint from './endpoints/nikolaus-slots';
import CreateNikolausBookingEndpoint from './endpoints/nikolaus-booking-create';
import LookupNikolausBookingEndpoint from './endpoints/nikolaus-manage-lookup';
import ConfirmNikolausBookingEndpoint from './endpoints/nikolaus-manage-confirm';
import CancelNikolausBookingEndpoint from './endpoints/nikolaus-manage-cancel';
import UpdateNikolausBookingEndpoint from './endpoints/nikolaus-manage-update';
import RescheduleNikolausBookingEndpoint from './endpoints/nikolaus-manage-reschedule';
import ResendNikolausLinkEndpoint from './endpoints/nikolaus-manage-resend-link';
import GeocodeNikolausAddressEndpoint from './endpoints/nikolaus-geocode';
import GetInternNikolausBookingsEndpoint from './endpoints/intern-nikolaus-bookings';

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

app.http('blogImage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'blog/{id}/image',
  handler: GetBlogImage,
});

app.http('blog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetBlogEndpoint,
});

app.http('downloads', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: GetDownloadFilesEndpoint,
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
