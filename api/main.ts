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
import GetNikolausBookingEndpoint from './endpoints/nikolaus-booking-get';
import ConfirmNikolausBookingEndpoint from './endpoints/nikolaus-booking-confirm';
import CancelNikolausBookingEndpoint from './endpoints/nikolaus-booking-cancel';

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

app.http('nikolausBookingGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'nikolaus/bookings/{id}',
  handler: GetNikolausBookingEndpoint,
});

app.http('nikolausBookingConfirm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/bookings/{id}/confirm',
  handler: ConfirmNikolausBookingEndpoint,
});

app.http('nikolausBookingCancel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/bookings/{id}/cancel',
  handler: CancelNikolausBookingEndpoint,
});
