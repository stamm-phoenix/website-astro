import { app, type HttpResponseInit } from '@azure/functions';
import { listDownloads } from '../lib/downloads';
import { toPublicDownload } from '../lib/downloads-public';
import { withErrorHandling } from '../lib/response-utils';

/** The public list; who uploaded a file stays internal. */
export async function GetDownloadFilesEndpoint(): Promise<HttpResponseInit> {
  const files = await listDownloads();
  return {
    status: 200,
    jsonBody: files.map(toPublicDownload),
  };
}

const defaultHandler = withErrorHandling(GetDownloadFilesEndpoint);
export default defaultHandler;

app.http('downloads', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: defaultHandler,
});
