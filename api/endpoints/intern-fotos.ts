import { HELP_CONTACTS } from '../lib/help-contacts';
import type { HttpResponseInit } from '@azure/functions';
import { CampflowError } from '../lib/campflow';
import { fotoMail, fotoRecipients } from '../lib/foto-benachrichtigung';
import {
  aktionFotoPath,
  fotoKind,
  fotoOrdnerLink,
  fotoNameCandidates,
  isCleanName,
  splitFotoPath,
} from '../lib/foto-pfade';
import {
  FotoLibraryMissingError,
  FotoNameTakenError,
  FotoPathConflictError,
  createFotoUploadSession,
  ensureFotoFolder,
  getFotoFile,
  listFotoFolder,
} from '../lib/fotos';
import { METHOD_NOT_ALLOWED, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { ValidationError } from '../lib/validation/errors';
import { mitEigenerAdresse } from '../lib/personen';
import { audienceVersion, protokollDeliveryAddresses } from '../lib/protokolle';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';
import { getPrincipalFirstName } from '../lib/staff-auth';

/** Largest file SharePoint accepts in an upload session. */
const MAX_FILE_BYTES = 250 * 1024 ** 3;
/** Names held by other files of an upload that one request may skip; at most every name tried. */
const MAX_RESERVED_NAMES = 50;
/** Files one note about new photos may name; far more than one upload of a weekend. */
const MAX_NOTE_FILES = 5000;

const FOLDER_NOT_FOUND = errorResponse(
  404,
  'NOT_FOUND',
  'Diesen Ordner gibt es nicht mehr. Vielleicht wurde er in SharePoint umbenannt oder verschoben. Geh eine Ebene zurück und wähle ihn neu.'
);

const FILE_NOT_FOUND = errorResponse(
  404,
  'NOT_FOUND',
  'Diese Datei gibt es nicht mehr. Vielleicht wurde sie in SharePoint gelöscht oder verschoben. Lade den Ordner neu.'
);

const CAMPFLOW_UNAVAILABLE = errorResponse(
  502,
  'CAMPFLOW_UNAVAILABLE',
  'Die Leitenden konnten nicht aus CampFlow geladen werden, es wurde nichts verschickt. Prüfe deine Internetverbindung und versuche es noch einmal.'
);

const LIBRARY_MISSING = errorResponse(
  503,
  'LIBRARY_MISSING',
  `Die Foto-Ablage in SharePoint wurde nicht gefunden. Bitte melde das an ${HELP_CONTACTS.technik}.`
);

function invalid(field: string, message: string): HttpResponseInit {
  return {
    status: 400,
    jsonBody: { error: 'INVALID', code: 'INVALID', message, fields: { [field]: message } },
  };
}

const INVALID_PATH = invalid(
  'pfad',
  'Der Ordnername enthält Zeichen, die SharePoint nicht erlaubt: " * : < > ? / \\ |'
);

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Maps the errors of the photo library; others are rethrown. */
async function withFotoErrors(work: () => Promise<HttpResponseInit>): Promise<HttpResponseInit> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof FotoLibraryMissingError) return LIBRARY_MISSING;
    if (error instanceof FotoNameTakenError) {
      return errorResponse(
        409,
        'NAME_TAKEN',
        `Im Ordner gibt es schon zu viele Dateien mit dem Namen „${error.fileName}“. Benenne die Datei um oder wähle einen anderen Ordner.`
      );
    }
    if (error instanceof FotoPathConflictError) {
      return errorResponse(
        409,
        'PATH_CONFLICT',
        `In der Foto-Ablage liegt eine Datei „${error.path}“, wo ein Ordner hin soll. Wähle einen anderen Ordner oder benenne die Datei in SharePoint um.`
      );
    }
    throw error;
  }
}

/** GET `?pfad=`: folders and files of a folder; without `pfad` the top folder of the library. */
export const FotosFolderEndpoint = pflegeHandler('fotos', async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  const path = request.query.get('pfad') ?? '';
  if (!splitFotoPath(path)) return INVALID_PATH;
  return withFotoErrors(async () => {
    const content = await listFotoFolder(path);
    return content ? ok(content) : FOLDER_NOT_FOUND;
  });
});

/** GET: a file with a large version, a fresh download link and, for videos, the player. */
export const FotosFileEndpoint = pflegeHandler('fotos', async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  const id = request.params.id ?? '';
  if (!/^[A-Za-z0-9!_-]{1,200}$/.test(id)) return FILE_NOT_FOUND;
  return withFotoErrors(async () => {
    const file = await getFotoFile(id);
    return file ? ok(file) : FILE_NOT_FOUND;
  });
});

/**
 * GET: `{ vorname }`, the first name the folder of an Aktion upload gets, so the form shows the
 * same folder that is created (the browser may see other claims than the API).
 *
 * POST: prepares the folder an upload goes to and creates what is missing.
 * - `{ jahr, aktion }`: `Aktionen/<Jahr>/<Aktion>/<Vorname>` with the first name of the
 *   logged-in person.
 * - `{ pfad, unterordner? }`: a folder chosen freely, optionally with a new folder inside.
 */
export const FotosTargetEndpoint = pflegeHandler('fotos-ziel', async (request, _context, user) => {
  if (request.method === 'GET') return ok({ vorname: getPrincipalFirstName(user) });
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);

  let path: string | null;
  if (body && 'aktion' in body) {
    const aktion = string(body.aktion);
    if (!aktion) return invalid('aktion', 'Bitte wähle eine Aktion aus.');
    path = aktionFotoPath(string(body.jahr), aktion, getPrincipalFirstName(user));
    if (!path) return invalid('aktion', 'Aus dem Namen der Aktion lässt sich kein Ordner bilden.');
  } else {
    const base = string(body?.pfad);
    const sub = string(body?.unterordner);
    if (!splitFotoPath(base)) return INVALID_PATH;
    if (sub && !isCleanName(sub)) {
      return invalid(
        'unterordner',
        'Der neue Ordnername enthält Zeichen, die SharePoint nicht erlaubt: " * : < > ? / \\ |'
      );
    }
    path = [base, sub].filter(Boolean).join('/');
    if (!path) return invalid('pfad', 'Bitte wähle einen Ordner aus, nicht die oberste Ebene.');
    if (!splitFotoPath(path)) {
      return invalid(
        'unterordner',
        'Der ganze Ordnerpfad ist zu lang. Wähle einen Ordner weiter oben oder einen kürzeren neuen Ordnernamen.'
      );
    }
  }

  return withFotoErrors(async () => ok(await ensureFotoFolder(path)));
});

/**
 * POST `{ pfad, name, size, neu?, belegt? }`: starts the upload of one photo or video into a
 * prepared folder and returns the URL the browser sends the file to, or `exists` if it is
 * already there. With `neu: true` an existing file never counts as the same one; names in
 * `belegt` (held by other files of the same upload) are skipped.
 */
export const FotosUploadEndpoint = pflegeHandler(
  'fotos-upload',
  async (request) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const path = string(body?.pfad);
    const name = string(body?.name);
    const size = body?.size;
    const newName = body?.neu === true;
    const reserved = body?.belegt ?? [];
    if (
      !Array.isArray(reserved) ||
      reserved.length > MAX_RESERVED_NAMES ||
      !reserved.every((entry) => typeof entry === 'string' && entry.length <= 255)
    ) {
      return invalid('belegt', 'Die Liste der belegten Namen ist ungültig.');
    }
    if (!splitFotoPath(path) || !path) return INVALID_PATH;
    if (!isCleanName(name)) {
      return invalid('name', 'Der Dateiname enthält Zeichen, die SharePoint nicht erlaubt.');
    }
    // The whole path counts, also with the longest number a taken name may get
    const longest = fotoNameCandidates(name).reduce((a, b) => (b.length > a.length ? b : a));
    if (!splitFotoPath(`${path}/${longest}`)) {
      return invalid(
        'name',
        `„${name}“ hat in diesem Ordner einen zu langen Pfad für SharePoint. Benenne die Datei kürzer oder wähle einen Ordner weiter oben.`
      );
    }
    if (fotoKind(name) === 'file') {
      return invalid('name', `„${name}“ ist kein Foto oder Video und wird nicht hochgeladen.`);
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
      return invalid('size', `„${name}“ ist leer und wird nicht hochgeladen.`);
    }
    if (size > MAX_FILE_BYTES) {
      return invalid('size', `„${name}“ ist größer als 250 GB und wird nicht hochgeladen.`);
    }
    return withFotoErrors(async () => {
      try {
        return ok(await createFotoUploadSession(path, name, size, { newName, reserved }));
      } catch (error: unknown) {
        // The folder was removed after the upload started
        if ((error as { statusCode?: unknown })?.statusCode === 404) return FOLDER_NOT_FOUND;
        throw error;
      }
    });
  },
  // One request per file; the target folder is logged once
  { quiet: true }
);

/**
 * Note to the leaders about new photos in a folder.
 * - `{ action: 'preview' }`: the recipients from CampFlow (with reasons), a version of that list
 *   and the people of the module „Personen“ to add by hand (`personen`).
 * - `{ action: 'send', pfad, dateien, version, excluded?, extra? }`: mails the note about the
 *   files named in `dateien` that are in the folder, to that list without the addresses in
 *   `excluded` and with those in `extra`, if the list still matches the confirmed version.
 */
export const FotosNoteEndpoint = pflegeHandler(
  'fotos-benachrichtigung',
  async (request, context, user) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const action = body?.action;
    if (action !== 'preview' && action !== 'send') {
      throw new ValidationError({ form: 'Unbekannte Aktion.' });
    }

    let members;
    try {
      members = await fotoMail.members();
    } catch (error: unknown) {
      if (!(error instanceof CampflowError)) throw error;
      context.error(error);
      return CAMPFLOW_UNAVAILABLE;
    }
    const recipients = fotoRecipients(members);
    const version = audienceVersion(recipients);
    if (action === 'preview') {
      const [list, personen] = await Promise.all([
        mitEigenerAdresse(user.userDetails, recipients),
        fotoMail.personen(members),
      ]);
      return ok({ recipients: recipients.length, version, list, personen });
    }

    const path = string(body?.pfad);
    if (!path || !splitFotoPath(path)) return INVALID_PATH;
    const names = body?.dateien;
    if (
      !Array.isArray(names) ||
      names.length === 0 ||
      names.length > MAX_NOTE_FILES ||
      !names.every((name) => typeof name === 'string' && name.length <= 255)
    ) {
      return invalid('dateien', 'Die Liste der hochgeladenen Dateien ist ungültig.');
    }
    if (body?.version !== version) {
      throw new ValidationError({
        form: 'Die Leitenden in CampFlow haben sich geändert. Bitte prüf die Liste und bestätige sie erneut.',
      });
    }
    const addresses = protokollDeliveryAddresses(recipients, body?.excluded, body?.extra);
    if (addresses.length === 0) {
      throw new ValidationError({
        form: 'Es ist niemand ausgewählt. Wähle mindestens eine Person aus oder trag eine Adresse ein.',
      });
    }

    return withFotoErrors(async () => {
      const folder = await listFotoFolder(path);
      if (!folder) return FOLDER_NOT_FOUND;
      // Only files that are really there, in the order they were named
      const byName = new Map(folder.files.map((file) => [file.name.toLowerCase(), file]));
      const files = [...new Set(names.map((name) => String(name).toLowerCase()))]
        .map((name) => byName.get(name))
        .filter((file) => file !== undefined);
      if (files.length === 0) {
        throw new ValidationError({
          form: 'Die hochgeladenen Dateien sind nicht mehr in diesem Ordner. Vielleicht wurden sie in SharePoint verschoben.',
        });
      }
      await fotoMail.send(addresses, {
        person: getPrincipalFirstName(user),
        replyTo: user.userDetails,
        path: folder.path,
        files,
        url: `${getSiteUrl(request)}${fotoOrdnerLink(folder.path)}`,
      });
      return ok({ recipients: addresses.length, files: files.length });
    });
  }
);

export const FotosFolder = withErrorHandling(FotosFolderEndpoint);
export const FotosNote = withErrorHandling(FotosNoteEndpoint);
export const FotosFile = withErrorHandling(FotosFileEndpoint);
export const FotosTarget = withErrorHandling(FotosTargetEndpoint);
export const FotosUpload = withErrorHandling(FotosUploadEndpoint);
