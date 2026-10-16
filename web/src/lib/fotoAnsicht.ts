/**
 * What the module „Fotos“ shows, kept in the URL hash (`#pfad=2026%2FSola&foto=…`) so that the
 * back button of the phone goes back one folder or closes the photo. A hash keeps the page:
 * the router of the site does not load it again for a change of the hash.
 */
export interface FotoAnsicht {
  /** Folder shown; empty for the top folder. */
  path: string;
  /** File open in the detail view. */
  foto: string | null;
  upload: boolean;
  /** Folder preset for an upload into a freely chosen folder. */
  ziel: string | null;
}

export function readFotoAnsicht(hash: string): FotoAnsicht {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return {
    path: params.get('pfad') ?? '',
    foto: params.get('foto') || null,
    upload: params.get('ansicht') === 'hochladen',
    ziel: params.get('ziel'),
  };
}

export function fotoAnsichtHash(view: FotoAnsicht): string {
  const params = new URLSearchParams();
  if (view.upload) {
    params.set('ansicht', 'hochladen');
    if (view.ziel !== null) params.set('ziel', view.ziel);
  } else {
    // Also for the top folder: a navigation to an empty hash would load the page again
    params.set('pfad', view.path);
    if (view.foto) params.set('foto', view.foto);
  }
  return `#${params.toString()}`;
}
