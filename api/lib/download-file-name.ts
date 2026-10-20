const DOWNLOAD_MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  rtf: 'application/rtf',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** The media type a download is served with, from the extension of its name. */
export function downloadMimeType(fileName: string): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  return DOWNLOAD_MIME_TYPES[extension] ?? 'application/octet-stream';
}

/** Preserve the existing type when punctuation in a title is not a supported extension. */
export function renamedDownloadFileName(entered: string, previous: string): string {
  const name = entered.trim();
  const previousExtension = /\.([a-z0-9]{1,8})$/i.exec(previous)?.[1];
  const supplied = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
  const explicit =
    supplied &&
    (Object.hasOwn(DOWNLOAD_MIME_TYPES, supplied) || supplied === previousExtension?.toLowerCase());
  return name && previousExtension && !explicit ? `${name}.${previousExtension}` : name;
}
