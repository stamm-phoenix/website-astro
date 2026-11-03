import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeitungPlanung } from '../../api/lib/essen-leitung-model';
import { planungenFuerStartseite } from '../src/lib/essensplanungStartseite';

function planung(
  name: string,
  ersterTag: string | null,
  letzterTag: string | null,
  neu = false
): LeitungPlanung {
  return { planungId: 1, name, rolle: 'bearbeiten', ersterTag, letzterTag, token: name, neu };
}

test('invitations first, then running and coming Planungen, past ones left out', () => {
  const liste = planungenFuerStartseite(
    [
      planung('Vorbei', '2026-07-01', '2026-07-05'),
      planung('Herbstlager', '2026-11-20', '2026-11-22'),
      planung('Läuft', '2026-11-01', '2026-11-03'),
      planung('Ohne Tage', null, null),
      planung('Eingeladen, vorbei', '2026-06-01', '2026-06-02', true),
    ],
    '2026-11-03'
  );
  assert.deepEqual(
    liste.map((p) => p.name),
    ['Eingeladen, vorbei', 'Ohne Tage', 'Läuft', 'Herbstlager']
  );
});
