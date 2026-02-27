import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

type EndpointHandler = (
  request: HttpRequest,
  context: InvocationContext
) => Promise<HttpResponseInit>;

export function withErrorHandling(handler: EndpointHandler): EndpointHandler {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      return await handler(request, context);
    } catch (error: unknown) {
      context.error(error); // Log the raw unknown error
      let errorMessage = 'Internal Server Error';
      let errorName = 'Error';

      if (error instanceof Error) {
        errorName = error.name;
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        errorMessage = String(error);
      }

      return {
        status: 500,
        jsonBody: {
          error: errorName,
          message: errorMessage,
        },
      };
    }
  };
}

export async function proxyFile(
  url: string,
  context: InvocationContext,
  options?: {
    contentType?: string;
    contentDisposition?: string;
    token?: string; // For authenticated requests, e.g., SharePoint
  }
): Promise<HttpResponseInit> {
  const headers: Record<string, string> = {};

  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: headers,
  });

  if (!response.ok) {
    context.error(
      `Failed to fetch file from upstream: ${response.status} ${response.statusText} from ${url}`
    );
    return {
      status: response.status === 404 ? 404 : 502,
      body: 'Failed to fetch file from upstream source',
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const responseContentType =
    options?.contentType || response.headers.get('Content-Type') || 'application/octet-stream';

  const responseHeaders: Record<string, string> = {
    'Content-Type': responseContentType,
  };

  if (options?.contentDisposition) {
    responseHeaders['Content-Disposition'] = options.contentDisposition;
  }

  return {
    status: 200,
    body: new Uint8Array(arrayBuffer),
    headers: responseHeaders,
  };
}
