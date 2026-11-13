import { createResource } from './resource.svelte';
import type { StaffSchnupperAnfrage } from './schnupper';

/** The Schnupperstunden-Anfragen (`/intern/pflege/schnupperanfragen`). */
export const schnupperPflege = createResource<StaffSchnupperAnfrage[]>(
  '/intern/pflege/schnupperanfragen'
);
