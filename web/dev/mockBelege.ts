/** Belege: photos, CampFlow booking and the receipt list. */
import { registerBelegPruefungRoutes } from './mockBelegPruefung';
import type { StaffBeleg } from '../src/lib/types';
import { knowBelege, kostenstellen } from './mock-data/abrechnung';
import { documentPreviewSvg } from './mock-data/svg';
import { MOCK_NOW, newEtag, newId } from './mock-data/util';
import { belege, campflowBeleg, campflowBelege, mockBelegCheck } from './mock-data/belege';
import { error, jpeg, json, noContent, notFound, route, str, svg } from './mockCore';
import type { MockResult } from './mockCore';
import { PRINCIPAL } from './mockAuth';

// --- Belege ---

const belegPhotos = new Map<string, Uint8Array>();
const belegOriginals = new Map<string, Uint8Array>();
const belegPdfs = new Map<string, Uint8Array>();

/**
 * Stores `photo` and the optional `original` of a JSON body, or a `pdf` with its first page as
 * `photo`; returns an error if invalid.
 */
function storeBelegPhotos(beleg: StaffBeleg, body: Record<string, unknown>): MockResult | null {
  const photo = Buffer.from(str(body.photo), 'base64');
  const original = body.original ? Buffer.from(str(body.original), 'base64') : null;
  const pdf = body.pdf ? Buffer.from(str(body.pdf), 'base64') : null;
  for (const bytes of [photo, original]) {
    if (bytes && (bytes[0] !== 0xff || bytes[1] !== 0xd8))
      return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
  }
  if (pdf && pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return error(400, 'INVALID', 'Die Datei ist kein PDF. Bitte ein PDF oder ein Foto wählen.');
  }
  setBelegPhoto(beleg.id, photo);
  if (original) belegOriginals.set(beleg.id, new Uint8Array(original));
  else belegOriginals.delete(beleg.id);
  if (pdf) belegPdfs.set(beleg.id, new Uint8Array(pdf));
  else belegPdfs.delete(beleg.id);
  beleg.hasOriginal = original !== null;
  beleg.isPdf = pdf !== null;
  return null;
}

function setBelegPhoto(id: string, bytes: Uint8Array): void {
  belegPhotos.set(id, new Uint8Array(bytes));
}

function applyBeleg(target: StaffBeleg, body: Record<string, unknown>): void {
  target.art = body.art === 'Einnahme' ? 'Einnahme' : 'Ausgabe';
  target.shop = str(body.shop, target.shop);
  target.date = str(body.date, target.date);
  target.amountCent = typeof body.amountCent === 'number' ? body.amountCent : target.amountCent;
  target.paidBy = str(body.paidBy, target.paidBy);
  target.payout = target.art === 'Ausgabe' && body.payout === true;
  // Like the server: without an Auslage nobody is named
  if (!target.payout) target.paidBy = '';
  target.kostenstelle = str(body.kostenstelle, target.kostenstelle).trim();
  target.kategorie = str(body.kategorie, target.kategorie).trim();
  target.note = str(body.note, target.note);
  target.status = (str(body.status, target.status) as StaffBeleg['status']) || 'Eingereicht';
  target.reviewNote = str(body.reviewNote, target.reviewNote);
  target.etag = newEtag(`beleg-${target.id}`);
}

route(['GET', 'POST'], '/api/intern/pflege/belege', (req) => {
  if (req.method === 'GET') {
    // Like the API: the name of who submitted it, and whether the demo user may still change it
    const namen: Record<string, string> = {
      [PRINCIPAL.userDetails]: 'Demo Leitung',
      'sam@example.test': 'Sam Muster',
      'kim@example.test': 'Kim Beispiel',
    };
    return json(
      belege.map((beleg) => ({
        ...beleg,
        ...(namen[beleg.submittedBy] ? { submittedByName: namen[beleg.submittedBy] } : {}),
        editable: !beleg.readOnly && beleg.status !== 'Angenommen',
      }))
    );
  }
  const body = req.json ?? {};
  const beleg: StaffBeleg = {
    id: newId(),
    etag: '',
    art: 'Ausgabe',
    shop: '',
    date: '',
    amountCent: 0,
    paidBy: '',
    payout: false,
    aktion: '',
    kostenstelle: '',
    kategorie: '',
    note: '',
    status: 'Eingereicht',
    reviewNote: '',
    submittedBy: PRINCIPAL.userDetails,
    submittedAt: new Date(MOCK_NOW).toISOString(),
    hasImage: true,
    hasOriginal: false,
    isPdf: false,
    aiCheck: mockBelegCheck(),
    campflow: null,
  };
  const invalid = storeBelegPhotos(beleg, body);
  if (invalid) return invalid;
  applyBeleg(beleg, { ...body, status: 'Eingereicht', reviewNote: '' });
  belege.unshift(beleg);
  return json({ id: beleg.id }, 201);
});

registerBelegPruefungRoutes(route, mockBelegCheck);

route(['GET'], '/api/intern/pflege/belege/rolle', () =>
  json({ reviewer: PRINCIPAL.userRoles.includes('team_kasse') })
);

// Read from CampFlow by the Playwright API in production
route(['GET'], '/api/intern/pflege/belege/campflow', () => {
  knowBelege(campflowBelege.map((beleg) => beleg.number ?? beleg.id));
  return json({
    loadedAt: new Date(MOCK_NOW).toISOString(),
    costUnits: kostenstellen,
    belege: campflowBelege,
  });
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/belege/:id', (req) => {
  const index = belege.findIndex((b) => b.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    belege.splice(index, 1);
    return noContent();
  }
  if (str(req.json?.status) === 'Abgelehnt' && !str(req.json?.reviewNote).trim()) {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      reviewNote: 'Bitte begründen, warum der Beleg abgelehnt wird.',
    });
  }
  const rejected = str(req.json?.status) === 'Abgelehnt' && belege[index].status !== 'Abgelehnt';
  applyBeleg(belege[index], req.json ?? {});
  // The demo pretends the rejection mail was sent
  return json({ mailed: rejected, etag: belege[index].etag });
});

route(
  ['GET', 'PUT'],
  '/api/intern/pflege/belege/:id/foto',
  (req) => {
    const beleg = belege.find((b) => b.id === req.params.id);
    if (!beleg) return notFound();
    if (req.method === 'PUT') {
      const invalid = storeBelegPhotos(beleg, req.json ?? {});
      if (invalid) return invalid;
      beleg.hasImage = true;
      beleg.etag = newEtag(`beleg-${beleg.id}`);
      return json(beleg);
    }
    const pdf = belegPdfs.get(beleg.id);
    if (pdf && req.query.get('download') && !req.query.get('original')) {
      return { kind: 'raw', status: 200, contentType: 'application/pdf', body: pdf };
    }
    const stored = (req.query.get('original') ? belegOriginals : belegPhotos).get(beleg.id);
    if (stored) return jpeg(stored);
    return svg(documentPreviewSvg(`${beleg.shop}.jpg`, 600, 800));
  },
  true
);

/** Next Belegnummer the demo CampFlow hands out. */
let nextCampflowNumber = 112;

// Like the API: checks the version, books the receipt in the demo CampFlow and deletes it here
route('POST', '/api/intern/pflege/belege/:id/campflow', (req) => {
  const index = belege.findIndex((b) => b.id === req.params.id);
  if (index < 0) return notFound();
  const beleg = belege[index];
  if (str(req.json?.etag) !== beleg.etag) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  if (beleg.status !== 'Angenommen') {
    return error(
      422,
      'NOT_ACCEPTED',
      'Nur angenommene Belege können nach CampFlow übertragen werden.'
    );
  }
  if (!beleg.kostenstelle || !beleg.kategorie) {
    return error(400, 'NO_TARGET', 'Bitte zuerst Kostenstelle und Kategorie eintragen.');
  }
  // Like the API: whatever the demo CampFlow lacks is created first
  const same = (a: string, b: string) => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de');
  let unit = kostenstellen.find((k) => !k.archived && same(k.name, beleg.kostenstelle));
  if (!unit) {
    if (kostenstellen.some((k) => same(k.name, beleg.kostenstelle))) {
      return error(
        422,
        'KOSTENSTELLE_ARCHIVED',
        `Die Kostenstelle „${beleg.kostenstelle}“ ist in CampFlow archiviert. Bitte trage oben im Beleg eine andere Kostenstelle ein und übertrage ihn dann noch einmal.`
      );
    }
    unit = { id: `cun_${newId()}`, name: beleg.kostenstelle, archived: false, categories: [] };
    kostenstellen.push(unit);
  }
  let category = unit.categories.find((c) => same(c.name, beleg.kategorie));
  if (!category) {
    category = { id: `cat_${newId()}`, name: beleg.kategorie };
    unit.categories.push(category);
  }
  belege.splice(index, 1);
  const number = `2026-${nextCampflowNumber++}`;
  const payout = beleg.payout && beleg.paidBy.trim() ? beleg.paidBy.trim() : null;
  // Income is booked with a positive amount
  const amountCent = beleg.art === 'Einnahme' ? beleg.amountCent : -beleg.amountCent;
  campflowBelege.unshift(
    campflowBeleg({
      id: `exp_${number}`,
      status: 'open',
      number,
      description: [beleg.shop, beleg.note].filter(Boolean).join(' – '),
      date: beleg.date,
      amountCent,
      openCent: amountCent,
      paidBy: payout,
      costUnits: [{ id: unit.id, name: unit.name }],
      categories: [{ id: category.id, name: category.name, costUnitId: unit.id }],
      uploadedAt: new Date(MOCK_NOW).toISOString().slice(0, 19).replace('T', ' '),
      viaWebsite: true,
      submittedByMe: beleg.submittedBy === PRINCIPAL.userDetails,
    })
  );
  return json({
    campflow: {
      state: 'Hochgeladen',
      costUnitId: unit.id,
      costUnitName: unit.name,
      categoryId: category.id,
      categoryName: category.name,
      number,
      error: '',
      startedBy: PRINCIPAL.userDetails,
      startedAt: new Date(MOCK_NOW).toISOString(),
    },
    created: true,
    deleted: true,
  });
});
