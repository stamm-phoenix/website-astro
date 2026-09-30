import type { HttpResponseInit, InvocationContext } from '@azure/functions';
import { getCredential } from './token';
import { EnvironmentVariable, getEnvironment } from './environment';
import { proxyFile } from './response-utils';

export function getMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Proxies a thumbnail of an image attached to a list item.
 * @param dimension Bounding box such as `1920x1080`; SharePoint picks the closest size.
 */
export async function fetchSharePointImage(
  listId: string,
  itemId: string,
  imageFileName: string,
  dimension: string,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

  const SHAREPOINT_SITE_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_NAME);

  const credential = getCredential();

  const token = await credential.getToken(`https://${SHAREPOINT_HOST_NAME}/.default`);

  const apiUrl = `https://${SHAREPOINT_HOST_NAME}/sites/${SHAREPOINT_SITE_NAME}/_api/v2.1/sites('${SHAREPOINT_SITE_ID}')/lists('${listId}')/items('${itemId}')/attachments('${encodeURIComponent(
    imageFileName
  )}')/thumbnails/0/c${dimension}/content?prefer=noredirect,closestavailablesize`;

  return await proxyFile(apiUrl, context, {
    contentType: getMimeType(imageFileName),
    token: token.token,
  });
}

/** Width and height from the frame header of a JPEG, or undefined if there is none. */
export function getJpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    // Fill bytes and markers without a length
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // Start of frame (SOF0–SOF15 without DHT, JPG and DAC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (marker === 0xda || length < 2) return undefined; // image data starts, no frame found
    offset += 2 + length;
  }
  return undefined;
}
