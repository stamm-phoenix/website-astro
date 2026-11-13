import { app } from '@azure/functions';
import { SchnupperAnfrageSend } from './schnupperanfrage';
import {
  SchnupperAnfrageAbsagenEndpoint,
  SchnupperAnfrageBestaetigenEndpoint,
  SchnupperAnfrageItemEndpoint,
  SchnupperAnfragenCollectionEndpoint,
} from './intern-pflege-schnupperanfragen';

/** Routes of the Schnupperstunden-Anfragen (#139): the public form and the staff module. */
app.http('schnupperAnfrageSend', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'schnupperanfrage',
  handler: SchnupperAnfrageSend,
});

app.http('internPflegeSchnupperanfragen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/schnupperanfragen',
  handler: SchnupperAnfragenCollectionEndpoint,
});

app.http('internPflegeSchnupperanfrage', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/schnupperanfragen/{id}',
  handler: SchnupperAnfrageItemEndpoint,
});

app.http('internPflegeSchnupperanfrageBestaetigen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/schnupperanfragen/{id}/bestaetigen',
  handler: SchnupperAnfrageBestaetigenEndpoint,
});

app.http('internPflegeSchnupperanfrageAbsagen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/schnupperanfragen/{id}/absagen',
  handler: SchnupperAnfrageAbsagenEndpoint,
});
