import type { MockRequest, MockResult } from './mockCore';
import type { StaffBeleg } from '../src/lib/types';

/** The demo check of receipt photos and PDF pages, as `/api/intern/pflege/belege/pruefung`. */

const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const error = (status: number, code: string, message: string): MockResult =>
  json({ error: code, code, message }, status);

export function registerBelegPruefungRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult
  ) => void,
  check: () => NonNullable<StaffBeleg['aiCheck']>
): void {
  route('POST', '/api/intern/pflege/belege/pruefung', (req) => {
    // The pages of a PDF come as `{ pages }`, a photo as it is
    const pages = req.json?.pages;
    if (Array.isArray(pages)) {
      if (pages.length < 1 || pages.length > 5 || req.query.get('nur'))
        return error(400, 'INVALID', 'Es werden höchstens 5 Seiten eines PDFs geprüft.');
      return json({ available: true, check: check() });
    }
    if (req.raw[0] !== 0xff || req.raw[1] !== 0xd8)
      return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
    if (req.query.get('nur') === 'drehung') return json({ available: true, rotation: 0 });
    return json({ available: true, check: check() });
  });
}
