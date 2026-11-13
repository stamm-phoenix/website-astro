/**
 * The agenda of the minutes as one document in the formatting editor (#277): every agenda item
 * is a block with a title, a text and its tasks and dates; sub-items are blocks inside their
 * item. The document is written back into `ProtokollPunkt[]` on every change, so the stored
 * shape, the reading view, the PDF and the live reading stay as they are.
 *
 * Only this module knows the shape of the document; `ProtokollDokument.svelte` shows it.
 */
import {
  PunktTitel,
  PunktText,
  PunktExtras,
  Unterpunkt,
  Punkt,
  Dokument,
} from './protokollDokumentNodes';
import { Guard, Keys } from './protokollDokumentGuard';
import { getSchema } from '@tiptap/core';
import type { Extensions, NodeViewRenderer } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { PROTOKOLL_TEXT_FEATURES } from './protokollEditor';
import { editorExtensions } from './textEditor';

// --- Extensions ---

/** How the editor shows the agenda nodes; without them the plain elements are rendered. */
export interface DokumentNodeViews {
  punkt: NodeViewRenderer;
  titel: NodeViewRenderer;
  text: NodeViewRenderer;
  extras: NodeViewRenderer;
}

/** The extensions of the document editor: the agenda nodes and the text tools of the minutes. */
export function dokumentExtensions(views?: DokumentNodeViews): Extensions {
  const text = editorExtensions(PROTOKOLL_TEXT_FEATURES, '', 'markdown').filter(
    (extension) => extension.name !== 'doc' && extension.name !== 'markdown'
  );
  const nodes = views
    ? [
        Punkt.extend({ addNodeView: () => views.punkt }),
        Unterpunkt.extend({ addNodeView: () => views.punkt }),
        PunktTitel.extend({ addNodeView: () => views.titel }),
        PunktText.extend({ addNodeView: () => views.text }),
        PunktExtras.extend({ addNodeView: () => views.extras }),
      ]
    : [Punkt, Unterpunkt, PunktTitel, PunktText, PunktExtras];
  return [Dokument, ...nodes, ...text, Guard, Keys];
}

/** The schema of the document editor, for the conversion outside an editor (tests). */
export function dokumentSchema(): Schema {
  return getSchema(dokumentExtensions());
}
