import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

type EndpointHandler = (
  request: HttpRequest,
  context: InvocationContext
) => Promise<HttpResponseInit>;

interface ErrorHandlingOptions {
  exposeErrorDetails?: boolean;
}

/**
 * Wraps an endpoint handler with centralized exception handling.
 *
 * @param handler - The endpoint handler to invoke.
 * @param options - Controls whether exception details are included in error responses.
 * @returns A handler that returns the original response on success or an HTTP 500 response after logging an exception.
 */
export function withErrorHandling(
  handler: EndpointHandler,
  options?: ErrorHandlingOptions
): EndpointHandler {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      return await handler(request, context);
    } catch (error: unknown) {
      context.error(error);

      if (!options?.exposeErrorDetails) {
        return {
          status: 500,
          jsonBody: {
            error: 'Error',
            message: 'Internal Server Error',
          },
        };
      }

      const errorName = error instanceof Error ? error.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);

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

/** Largest file `proxyFile` reads into memory unless the caller sets `maxBytes`. */
export const PROXY_FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Thrown by `readLimited` when a response body exceeds its limit. */
export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`Response body is larger than ${limit} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads the response body, but no more than `limit` bytes. Content-Length only allows an early
 * rejection, as it may be missing or wrong.
 *
 * @throws ResponseTooLargeError if the body is larger than `limit`
 */
export async function readLimited(
  response: Response,
  limit: number
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > limit) {
    await response.body?.cancel();
    throw new ResponseTooLargeError(limit);
  }
  if (!response.body) {
    return new Uint8Array(0);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ResponseTooLargeError(limit);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetches a file from an upstream URL and returns it as an HTTP response.
 *
 * The timeout covers the whole download, not only the response headers.
 *
 * @param url - The upstream file URL
 * @param context - The invocation context used to report upstream failures
 * @param options - Optional authentication, response header, timeout and size settings
 * @returns An HTTP response containing the file, or an error response for upstream failures,
 *   timeouts and files larger than `maxBytes`
 * @throws Rethrows errors that are not caused by a request timeout or an oversized file
 */
export async function proxyFile(
  url: string,
  context: InvocationContext,
  options?: {
    contentType?: string;
    contentDisposition?: string;
    token?: string; // For authenticated requests, e.g., SharePoint
    timeout?: number; // Timeout in milliseconds for the whole download
    maxBytes?: number; // Largest file read into memory, default PROXY_FILE_MAX_BYTES
  }
): Promise<HttpResponseInit> {
  const headers: Record<string, string> = {};

  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const timeout = options?.timeout ?? 30000; // Default 30s
  const maxBytes = options?.maxBytes ?? PROXY_FILE_MAX_BYTES;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      context.error(
        `Failed to fetch file from upstream: ${response.status} ${response.statusText} from ${url}`
      );
      return {
        status: response.status === 404 ? 404 : 502,
        body: 'Failed to fetch file from upstream source',
      };
    }

    // Still under the timeout: a server may send the headers at once and then stall the body.
    const body = await readLimited(response, maxBytes);
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
      body,
      headers: responseHeaders,
    };
  } catch (error: unknown) {
    if (error instanceof ResponseTooLargeError) {
      context.error(`File from ${url} is larger than ${maxBytes} bytes`);
      return {
        status: 502,
        body: 'Upstream file is too large',
      };
    }
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      context.error(`Request to ${url} timed out after ${timeout}ms`);
      return {
        status: 504,
        body: 'Upstream request timed out',
      };
    }
    throw error;
  } finally {
    clearTimeout(id);
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

/**
 * Builds a JSON error response with a machine-readable code and a user-facing message.
 */
export function errorResponse(status: number, code: string, message: string): HttpResponseInit {
  return {
    status,
    jsonBody: {
      error: code,
      code,
      message,
    },
  };
}
