import type { HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import { EnvironmentVariable, getEnvironment } from '../lib/environment';
import { getLeitende } from '../lib/leitende-list';
import { fetchSharePointImage } from '../lib/sharepoint-images';
import { withErrorHandling } from '../lib/response-utils';

export async function GetLeitendeImageInternal(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const itemId = request.params.id;
  if (!itemId) {
    return {
      status: 400,
      body: 'No item ID provided',
    };
  }

  const leitende = await getLeitende();

  const item = leitende.find((l) => l.id === itemId);

  if (!item) {
    return {
      status: 404,
      body: `Leitende with ID ${itemId} not found`,
    };
  }

  if (!item.imageFileName) {
    return {
      status: 404,
      body: `No image found for leitende with ID ${itemId}`,
    };
  }

  const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID);

  return await fetchSharePointImage(listId, item.id, item.imageFileName, '300x300', context);
}

export const GetLeitendeImage = withErrorHandling(GetLeitendeImageInternal);
