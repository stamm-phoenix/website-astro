import { app } from '@azure/functions';
import GetAktionenIcsEndpoint from './aktionen-ics';
import GetAktionenStufeIcsEndpoint from './aktionen-stufe-ics';
import GetLeitendeIcsEndpoint from './leitende-ics';

app.http('aktionenIcs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'aktionen.ics',
  handler: GetAktionenIcsEndpoint,
});

app.http('aktionenStufeIcs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'aktionen/{stufe}.ics',
  handler: GetAktionenStufeIcsEndpoint,
});

app.http('leitendeIcs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'leitende.ics',
  handler: GetLeitendeIcsEndpoint,
});
