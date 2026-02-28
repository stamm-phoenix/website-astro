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
    timeout?: number; // Timeout in milliseconds
  }
): Promise<HttpResponseInit> {
  const headers: Record<string, string> = {};

  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const timeout = options?.timeout ?? 30000; // Default 30s
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: headers,
      signal: controller.signal,
    });

    clearTimeout(id);

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
  } catch (error: unknown) {
    clearTimeout(id);
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      context.error(`Request to ${url} timed out after ${timeout}ms`);
      return {
        status: 504,
        body: 'Upstream request timed out',
      };
    }
    throw error;
  }
}

/**
 * Encodes a filename for use in a Content-Disposition header, supporting non-ASCII characters.
 * @param fileName The filename to encode.
 * @returns The encoded Content-Disposition value (e.g., "attachment; filename=\"... \"; filename*=UTF-8''...").
 */
export function encodeContentDisposition(fileName: string): string {
  // RFC 6266 and RFC 5987/8187
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

  // Simple ASCII-only fallback (replace non-ASCII characters and quotes with underscores)
  const asciiFileName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '_');

  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`;
}
