/** Conversion between the agenda document and `ProtokollPunkt[]`. See `protokollDokument.ts`. */
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { MarkdownManager } from '@tiptap/markdown';
import { PROTOKOLL_TEXT_FEATURES, neuerPunkt, newElementId } from './protokollEditor';
import { markdownManager, normalizeBullets } from './textEditor';
import type {
  OffeneAufgabe,
  ProtokollAktion,
  ProtokollAufgabe,
  ProtokollProjekt,
  ProtokollPunkt,
  ProtokollZeitraum,
  PunktTermin,
} from '../../../api/lib/protokoll-editor-model';

// --- Conversion ---

/** An item or sub-item without content, built without reading Markdown. */
export function leererPunktNode(schema: Schema, id: string, sub: boolean): PMNode {
  const children = [
    schema.nodes.punktTitel.create({ aktion: null }),
    schema.nodes.punktText.create(null, schema.nodes.paragraph.create()),
    schema.nodes.punktExtras.create({
      aufgaben: [],
      termine: [],
      projekt: null,
      offeneAufgaben: [],
      zeitraum: null,
    }),
  ];
  return schema.nodes[sub ? 'unterpunkt' : 'punkt'].create({ id }, children);
}

/** The content of an item as one string, to notice a change whatever the order of its keys. */
export function punktKey(punkt: ProtokollPunkt): string {
  return JSON.stringify([
    punkt.id,
    punkt.titel,
    punkt.aktion,
    punkt.zeitraum,
    punkt.text,
    punkt.aufgaben,
    punkt.termine,
    punkt.projekt,
    punkt.offeneAufgaben,
    punkt.unterpunkte.map(punktKey),
  ]);
}

export function punkteKey(punkte: ProtokollPunkt[]): string {
  return punkte.map(punktKey).join('\n');
}

/** Converts between the agenda and the document; one per editor. */
export class DokumentUmwandlung {
  readonly schema: Schema;
  private readonly manager: MarkdownManager;
  /** Markdown of text nodes already serialized; nodes are immutable, so the text is too. */
  private readonly texte = new WeakMap<PMNode, string>();

  constructor(schema: Schema, manager: MarkdownManager = markdownManager(PROTOKOLL_TEXT_FEATURES)) {
    this.schema = schema;
    this.manager = manager;
  }

  /** The blocks of a text; a text that cannot be read becomes one paragraph with the text. */
  private textNodes(text: string): PMNode[] {
    const { schema } = this;
    try {
      const json = this.manager.parse(normalizeBullets(text));
      const nodes = (json.content ?? []).map((block) => schema.nodeFromJSON(block));
      if (nodes.length > 0) return nodes;
    } catch {
      if (text.trim()) return [schema.nodes.paragraph.create(null, schema.text(text))];
    }
    return [schema.nodes.paragraph.create()];
  }

  /**
   * The text node of an item. It remembers the stored Markdown, so an item nobody touched is
   * written back exactly as it was, not in the editor's own spelling.
   */
  private textNode(text: string): PMNode {
    const node = this.schema.nodes.punktText.create(null, Fragment.fromArray(this.textNodes(text)));
    this.texte.set(node, text);
    return node;
  }

  private kopf(punkt: ProtokollPunkt): PMNode[] {
    const { schema } = this;
    const titel = punkt.titel;
    return [
      schema.nodes.punktTitel.create(
        { aktion: punkt.aktion ? structuredClone(punkt.aktion) : null },
        titel ? schema.text(titel) : null
      ),
      this.textNode(punkt.text),
      schema.nodes.punktExtras.create({
        aufgaben: structuredClone(punkt.aufgaben),
        termine: structuredClone(punkt.termine),
        projekt: punkt.projekt ? structuredClone(punkt.projekt) : null,
        offeneAufgaben: structuredClone(punkt.offeneAufgaben),
        zeitraum: punkt.zeitraum ? structuredClone(punkt.zeitraum) : null,
      }),
    ];
  }

  unterpunktNode(punkt: ProtokollPunkt): PMNode {
    return this.schema.nodes.unterpunkt.create({ id: punkt.id }, this.kopf(punkt));
  }

  punktNode(punkt: ProtokollPunkt): PMNode {
    return this.schema.nodes.punkt.create({ id: punkt.id }, [
      ...this.kopf(punkt),
      ...punkt.unterpunkte.map((sub) => this.unterpunktNode(sub)),
    ]);
  }

  /** The whole agenda as a document; an empty agenda gets one empty item. */
  doc(punkte: ProtokollPunkt[]): PMNode {
    const items = punkte.length > 0 ? punkte : [neuerPunkt(newElementId())];
    return this.schema.topNodeType.create(
      null,
      items.map((punkt) => this.punktNode(punkt))
    );
  }

  private text(node: PMNode): string {
    const known = this.texte.get(node);
    if (known !== undefined) return known;
    const content = node.toJSON().content ?? [];
    const text = this.manager.serialize({ type: 'doc', content });
    this.texte.set(node, text);
    return text;
  }

  /** An item or sub-item as stored; the arrays are copies, so the editor keeps its own. */
  punkt(node: PMNode): ProtokollPunkt {
    const titel = node.child(0);
    const extras = node.child(2);
    const unterpunkte: ProtokollPunkt[] = [];
    node.forEach((child) => {
      if (child.type.name === 'unterpunkt') unterpunkte.push(this.punkt(child));
    });
    return {
      id: node.attrs.id,
      titel: titel.textContent,
      aktion: titel.attrs.aktion ? structuredClone(titel.attrs.aktion as ProtokollAktion) : null,
      zeitraum: extras.attrs.zeitraum
        ? structuredClone(extras.attrs.zeitraum as ProtokollZeitraum)
        : null,
      text: this.text(node.child(1)),
      aufgaben: structuredClone(extras.attrs.aufgaben as ProtokollAufgabe[]),
      termine: structuredClone(extras.attrs.termine as PunktTermin[]),
      projekt: extras.attrs.projekt
        ? structuredClone(extras.attrs.projekt as ProtokollProjekt)
        : null,
      offeneAufgaben: structuredClone(extras.attrs.offeneAufgaben as OffeneAufgabe[]),
      unterpunkte,
    };
  }

  punkte(doc: PMNode): ProtokollPunkt[] {
    const punkte: ProtokollPunkt[] = [];
    doc.forEach((node) => punkte.push(this.punkt(node)));
    return punkte;
  }
}

/**
 * The document for `punkte`, reusing the nodes of `current` whose item did not change, so the
 * editor keeps their views and the undo history stays small. Used when the agenda changes
 * outside the editor: an item added or moved, a version restored.
 */
export function rebuildDoc(
  umwandlung: DokumentUmwandlung,
  current: PMNode,
  punkte: ProtokollPunkt[]
): PMNode {
  const known = new Map<string, { node: PMNode; json: string }>();
  current.forEach((punkt) => {
    known.set(punkt.attrs.id, { node: punkt, json: punktKey(umwandlung.punkt(punkt)) });
    punkt.forEach((child) => {
      if (child.type.name === 'unterpunkt') {
        known.set(child.attrs.id, { node: child, json: punktKey(umwandlung.punkt(child)) });
      }
    });
  });
  const reuse = (punkt: ProtokollPunkt, sub: boolean): PMNode => {
    const old = known.get(punkt.id);
    const type = sub ? 'unterpunkt' : 'punkt';
    if (old && old.node.type.name === type && old.json === punktKey(punkt)) return old.node;
    if (sub) return umwandlung.unterpunktNode(punkt);
    // An item whose sub-items moved keeps its own content nodes
    const base = umwandlung.punktNode({ ...punkt, unterpunkte: [] });
    const children: PMNode[] = [];
    base.forEach((child) => children.push(child));
    return umwandlung.schema.nodes.punkt.create({ id: punkt.id }, [
      ...children,
      ...punkt.unterpunkte.map((child) => reuse(child, true)),
    ]);
  };
  const items = punkte.length > 0 ? punkte : [neuerPunkt(newElementId())];
  return umwandlung.schema.topNodeType.create(
    null,
    items.map((punkt) => reuse(punkt, false))
  );
}
