/** In-memory demo of Verleih. No mail is sent and no production data is used. */
import { route, json, error } from './mockCore';
import { PRINCIPAL } from './mockAuth';
import { inventurListe } from './mock-data/inventur';
import { validateVerleih, validateVerleihAktion } from '../../api/lib/validation/verleih';
import type { VerleihVorgang } from '../../api/lib/verleih-model';
let materialwart = PRINCIPAL.userDetails;
let settingsVersion = 1;
let counter = 2;
const beispiel = inventurListe()[0];
const vorgaenge: VerleihVorgang[] = beispiel
  ? [
      {
        id: 1,
        etag: '"verleih-1"',
        status: 'antrag',
        antragsteller: PRINCIPAL.userDetails,
        entleiher: 'Roverrunde',
        kontakt: PRINCIPAL.userDetails,
        verantwortlich: 'Demo Leitung',
        von: '2026-12-01',
        bis: '2026-12-03',
        notizen: 'Für das Winterwochenende.',
        entscheidung: '',
        entschiedenVon: '',
        mailOffen: 0,
        positionen: [
          {
            id: 1,
            artikelId: beispiel.id,
            varianteId: beispiel.varianten[0].id,
            bezeichnung: beispiel.bezeichnung,
            menge: 1,
            zurueck: 0,
          },
        ],
        verlauf: [
          { am: '2026-11-15T10:00:00Z', von: PRINCIPAL.userDetails, text: 'Ausleihe beantragt.' },
        ],
      },
    ]
  : [];
route(['GET', 'POST'], '/api/intern/pflege/verleih', (req) => {
  if (req.method === 'GET')
    return json({
      vorgaenge,
      materialwart,
      login: PRINCIPAL.userDetails,
      darfVerwalten: materialwart === PRINCIPAL.userDetails,
      darfEinrichten: true,
    });
  const input = validateVerleih(req.json);
  const id = counter++;
  const positionen = input.positionen.map((p, index) => {
    const artikel = inventurListe().find((a) => a.varianten.some((v) => v.id === p.varianteId));
    return {
      ...p,
      id: id * 100 + index,
      artikelId: artikel?.id ?? 0,
      bezeichnung: artikel?.bezeichnung ?? 'Entferntes Material',
      zurueck: 0,
    };
  });
  vorgaenge.unshift({
    ...input,
    positionen,
    id,
    etag: `"verleih-${id}"`,
    status: 'antrag',
    antragsteller: PRINCIPAL.userDetails,
    entscheidung: '',
    entschiedenVon: '',
    mailOffen: 0,
    verlauf: [
      { am: new Date().toISOString(), von: PRINCIPAL.userDetails, text: 'Ausleihe beantragt.' },
    ],
  });
  return json({ id, mailGesendet: true }, 201);
});
route(['GET', 'PATCH'], '/api/intern/pflege/verleih/einstellung', (req) => {
  if (req.method === 'PATCH') {
    materialwart = String(req.json?.materialwart ?? '');
    settingsVersion++;
  }
  return json({
    materialwart,
    etag: `"settings-${settingsVersion}"`,
    konten: [{ name: 'Demo Leitung', login: PRINCIPAL.userDetails }],
  });
});
route(['PATCH', 'POST'], '/api/intern/pflege/verleih/:id', (req) => {
  const v = vorgaenge.find((v) => v.id === Number(req.params.id));
  if (!v) return error(404, 'NOT_FOUND', 'Diese Ausleihe gibt es nicht mehr.');
  if (req.json?.etag !== v.etag)
    return error(409, 'CONFLICT', 'Die Ausleihe wurde inzwischen geändert. Bitte neu laden.');
  if (req.method === 'PATCH') {
    const input = validateVerleih(req.json);
    Object.assign(v, {
      ...input,
      positionen: input.positionen.map((p, i) => ({
        ...p,
        id: v.id * 100 + i,
        artikelId:
          inventurListe().find((a) => a.varianten.some((a) => a.id === p.varianteId))?.id ?? 0,
        bezeichnung:
          inventurListe().find((a) => a.varianten.some((a) => a.id === p.varianteId))
            ?.bezeichnung ?? '',
        zurueck: 0,
      })),
    });
  } else {
    const input = validateVerleihAktion(req.json);
    if (input.aktion === 'genehmigen') v.status = 'genehmigt';
    if (input.aktion === 'ablehnen') v.status = 'abgelehnt';
    if (input.aktion === 'ausgeben') v.status = 'ausgegeben';
    if (input.aktion === 'zurueckziehen' || input.aktion === 'stornieren')
      v.status = 'zurueckgezogen';
    if (input.aktion === 'rueckgabe') {
      for (const r of input.rueckgaben) {
        const p = v.positionen.find((p) => p.id === r.positionId);
        if (!p || p.zurueck + r.menge > p.menge)
          return error(400, 'INVALID', 'Die Rückgabe überschreitet die offene Menge.');
        p.zurueck += r.menge;
      }
      if (v.positionen.every((p) => p.zurueck === p.menge)) v.status = 'abgeschlossen';
    }
    v.entscheidung = input.nachricht;
    v.verlauf.push({
      am: new Date().toISOString(),
      von: PRINCIPAL.userDetails,
      text: `${v.status}${input.nachricht ? `: ${input.nachricht}` : ''}`,
    });
  }
  v.etag = `"verleih-${counter++}"`;
  return json({ id: v.id, mailGesendet: true });
});
route('POST', '/api/intern/pflege/verleih/:id/versand', () => json({ mailGesendet: true }));
