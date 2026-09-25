import type { HttpRequest } from '@azure/functions';
import { EnvironmentVariable, getEnvironment } from '../lib/environment';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointChoiceValues,
  getSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from '../lib/sharepoint-data-access';
import {
  addListItemAttachment,
  deleteListItemAttachment,
  toImageFieldValue,
  toLocationFieldValue,
  validateUpdateListItem,
} from '../lib/sharepoint-rest';
import type { LeitendeInput } from '../lib/pflege-validation';
import { MAX_PHOTO_BYTES, sortTeams, validateLeitende } from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readJsonBody,
} from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const IMAGE_FIELD = 'Image0';

interface LeitendeListItem {
  id: string;
  eTag?: string;
  fields: {
    Title?: string;
    Team?: string | string[];
    Telefon?: string;
    Street?: string;
    PostalCode?: string;
    City?: string;
    Image0?: string;
  };
}

function listId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID);
}

function getTeams(): Promise<string[]> {
  return getSharePointChoiceValues(listId(), 'Team');
}

/** File name of the photo attachment referenced by the image column, if any. */
function photoFileName(item: LeitendeListItem): string | undefined {
  if (!item.fields.Image0) return undefined;
  try {
    const parsed: unknown = JSON.parse(item.fields.Image0);
    const fileName = (parsed as { fileName?: unknown })?.fileName;
    return typeof fileName === 'string' && fileName ? fileName : undefined;
  } catch {
    return undefined;
  }
}

function toGraphFields(input: LeitendeInput): Record<string, unknown> {
  return {
    Title: input.name,
    'Team@odata.type': 'Collection(Edm.String)',
    Team: input.teams,
    Telefon: input.phone,
  };
}

async function list(): Promise<unknown> {
  const [items, teams] = await Promise.all([
    getSharePointListItems(listId(), { expand: 'fields' }) as Promise<LeitendeListItem[]>,
    getTeams(),
  ]);

  return {
    teams: sortTeams(teams),
    items: items.map((item) => {
      const rawTeams = item.fields.Team;
      return {
        id: item.id,
        etag: item.eTag ?? '',
        name: item.fields.Title ?? '',
        teams: Array.isArray(rawTeams) ? rawTeams : rawTeams ? [rawTeams] : [],
        phone: item.fields.Telefon ?? '',
        street: item.fields.Street ?? '',
        postalCode: item.fields.PostalCode ?? '',
        city: item.fields.City ?? '',
        hasImage: photoFileName(item) !== undefined,
      };
    }),
  };
}

/** GET: all Leitende with the available teams; POST: create a person. */
export const LeitendeCollectionEndpoint = pflegeHandler(
  'leitende',
  async (request: HttpRequest) => {
    if (request.method === 'GET') return ok(await list());
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const input = validateLeitende(await readJsonBody(request), await getTeams());
    const id = await createSharePointListItem(listId(), toGraphFields(input));
    const address = toLocationFieldValue(input);
    if (address) {
      // Graph cannot write location columns
      await validateUpdateListItem(listId(), id, { Adresse: address });
    }
    return ok({ id }, 201);
  }
);

/** PATCH: update a person (optimistic locking via etag); DELETE: remove the person. */
export const LeitendeItemEndpoint = pflegeHandler('leitende', async (request: HttpRequest) => {
  const id = request.params.id ?? '';
  if (!/^\d+$/.test(id)) return NOT_FOUND;

  if (request.method === 'DELETE') {
    await deleteSharePointListItem(listId(), id);
    return NO_CONTENT;
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

  const body = await readJsonBody(request);
  const input = validateLeitende(body, await getTeams());
  await updateSharePointListItem(listId(), id, toGraphFields(input), readEtag(body));
  await validateUpdateListItem(listId(), id, { Adresse: toLocationFieldValue(input) });
  return NO_CONTENT;
});

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** PUT: replace the photo with the JPEG in the body; DELETE: remove the photo. */
export const LeitendePhotoEndpoint = pflegeHandler(
  'leitende-foto',
  async (request: HttpRequest) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    const item = (await getSharePointListItem(listId(), id)) as LeitendeListItem | undefined;
    if (!item) return NOT_FOUND;
    const previous = photoFileName(item);

    if (request.method === 'DELETE') {
      await validateUpdateListItem(listId(), id, { [IMAGE_FIELD]: '' });
      if (previous) await deleteListItemAttachment(listId(), id, previous);
      return NO_CONTENT;
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) {
      return errorResponse(413, 'TOO_LARGE', 'Das Foto ist zu groß (höchstens 2 MB).');
    }
    if (!isJpeg(bytes)) {
      return errorResponse(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
    }

    // A new name per upload, so browsers and SharePoint thumbnails don't serve the old photo
    const fileName = `foto-${Date.now()}.jpg`;
    await addListItemAttachment(listId(), id, fileName, bytes);
    await validateUpdateListItem(listId(), id, {
      [IMAGE_FIELD]: toImageFieldValue(IMAGE_FIELD, fileName),
    });
    if (previous && previous !== fileName) {
      await deleteListItemAttachment(listId(), id, previous);
    }
    return ok({ hasImage: true });
  }
);

export const LeitendeCollection = withErrorHandling(LeitendeCollectionEndpoint);
export const LeitendeItem = withErrorHandling(LeitendeItemEndpoint);
export const LeitendePhoto = withErrorHandling(LeitendePhotoEndpoint);
