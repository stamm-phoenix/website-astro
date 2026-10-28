import { errorMessage, sendApi } from './api';
import {
  blobToBase64,
  BELEG_PHOTO_EDGE,
  MIN_BELEG_PHOTO_EDGE,
  canvasToJpeg,
  isPdfFile,
  loadPdfPage,
  loadPhoto,
  MAX_BELEG_PDF_BYTES,
  centToInput,
  photoWarnings as measurePhotoWarnings,
} from './belege';
import { todayIso } from './format';
import { findReceipt, fullFrame, isFullFrame, readPixels, toCanvas } from './belegScan';
import type { Pixels, Quad } from './belegScan';
import {
  ausrichten,
  bildBearbeiten,
  drehungen,
  eckenAusrichten,
  eckenErweitern,
  ganzesBild,
} from './belegBild';
import type { Ausrichtung, FotoFarben } from './belegBild';
import type { BelegCheck, StaffBeleg } from './types';
import type { BelegForm } from './belegForm';
import type { createDialogForm } from './dialogForm.svelte';
/** A chosen photo while it is being edited. */
interface Draft {
  original: Pixels;
  originalBlob: Blob;
  originalUrl: string;
  /** The photo rotated and mirrored as chosen; the original itself while it is not. */
  bild: Pixels;
  /** The receipt's corners in `bild`; null for the whole picture. */
  quad: Quad | null;
  mode: FotoFarben;
  /** The photo as it will be submitted; for a PDF the picture of its first page. */
  result: { blob: Blob; url: string; width: number; height: number } | null;
  /** The chosen PDF, submitted as it is; its first page is `original`. Not edited. */
  pdf: Blob | null;
}

/** The crop tool while it is open: the uncropped picture and the corners being moved. */
interface Zuschnitt {
  url: string;
  width: number;
  height: number;
  quad: Quad;
}

/** Whether anything was changed, so the photo differs from the one chosen. */
function isEdited(draft: Draft): boolean {
  return draft.bild !== draft.original || draft.quad !== null || draft.mode !== 'original';
}

/** Share of the receipt's long edge left around a found receipt, so no letter at its edge is cut. */
const RAND = 0.02;

interface Options {
  form: () => BelegForm | null;
  dialog: ReturnType<typeof createDialogForm>;
  notice: (message: string | null) => void;
  applyPhoto: (saved: StaffBeleg) => void;
}
interface BelegPhotoDraft {
  readonly photoBusy: boolean;
  readonly draft: Draft | null;
  readonly scanHint: string | null;
  readonly zuschnitt: Zuschnitt | null;
  readonly edited: boolean;
  readonly photoWarnings: string[];
  readonly aiChecking: boolean;
  readonly aiNotice: string | null;
  choosePhoto: (event: Event) => Promise<void>;
  clearDraft: () => void;
  setMode: (mode: FotoFarben) => void;
  ausrichten: (schritt: Ausrichtung) => void;
  zuruecksetzen: () => void;
  zuschneiden: () => Promise<void>;
  setZuschnitt: (quad: Quad) => void;
  zuschnittFertig: () => Promise<void>;
  zuschnittAbbrechen: () => void;
  savePhoto: () => Promise<void>;
  photoPayload: (draft: Draft) => Promise<{ photo: string; original?: string; pdf?: string }>;
  fertig: () => Promise<void>;
  reset: () => void;
}
export function createBelegPhotoDraft(options: Options): BelegPhotoDraft {
  const dialog = options.dialog;
  let photoBusy = $state(false);
  let draft = $state.raw<Draft | null>(null);
  let zuschnitt = $state.raw<Zuschnitt | null>(null);
  /** Hint about the found edges of the receipt. */
  let scanHint = $state<string | null>(null);
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  /** The check waiting for the edits to settle, and the one running with what follows it. */
  let geplant: (() => Promise<void>) | null = null;
  let laufend: Promise<void> | null = null;
  /** Quality hints for the photo chosen last. */
  let photoWarnings = $state<string[]>([]);
  /** KI-Vorprüfung of the photo chosen for a new receipt. */
  let aiChecking = $state(false);
  let aiNotice = $state<string | null>(null);
  /** Increments per chosen photo, so a late check result of an older photo is ignored. */
  let photoGeneration = 0;
  /** The photo whose direction was asked; each photo is turned upright at most once on its own. */
  let aufgerichtet: Pixels | null = null;
  /** The check itself renders the photo it turned upright; that render plans no other check. */
  let imPruefen = false;
  /** A direction that came while the crop tool was open, applied once it closes. */
  let offeneDrehung: { bild: Pixels; grad: 0 | 90 | 180 | 270 } | null = null;

  function clearDraft(): void {
    if (draft) {
      URL.revokeObjectURL(draft.originalUrl);
      if (draft.result) URL.revokeObjectURL(draft.result.url);
    }
    clearTimeout(checkTimer);
    geplant = null;
    offeneDrehung = null;
    zuschnittSchliessen();
    draft = null;
    scanHint = null;
  }

  /** Lets the browser paint the busy state before the heavy pixel work starts. */
  function nextFrame(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 20));
  }

  async function choosePhoto(event: Event): Promise<void> {
    const form = options.form();
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !form) return;

    photoBusy = true;
    dialog.state.error = null;
    dialog.state.conflict = false;
    if (isPdfFile(file)) {
      try {
        await choosePdf(file);
      } finally {
        photoBusy = false;
      }
      return;
    }
    try {
      await nextFrame();
      const canvas = await loadPhoto(file);
      if (Math.max(canvas.width, canvas.height) < MIN_BELEG_PHOTO_EDGE) {
        dialog.state.fields.photo =
          'Das Foto ist zu klein und kann nicht eingereicht werden. Bitte wähle ein Foto mit mindestens 800 Pixeln an der längeren Seite.';
        return;
      }
      dialog.clearField('photo');
      photoWarnings = measurePhotoWarnings(canvas);
      const original = readPixels(canvas, canvas.width, canvas.height);
      const originalBlob = await canvasToJpeg(canvas);
      clearDraft();
      const found = findReceipt(original);
      let quad: Quad | null = found;
      let mode: FotoFarben = 'farbe';
      if (!found) {
        scanHint =
          'Ränder nicht erkannt. Mit „Zuschneiden“ ziehst du die Ecken selbst auf den Beleg.';
      } else if (isFullFrame(found, original.width, original.height)) {
        // The photo shows only the receipt, e.g. a scan of the phone camera
        quad = null;
        mode = 'original';
      } else {
        quad = eckenErweitern(found, original.width, original.height, RAND);
      }
      draft = {
        original,
        originalBlob,
        originalUrl: URL.createObjectURL(originalBlob),
        bild: original,
        quad,
        mode,
        result: null,
        pdf: null,
      };
      dialog.clearField('photo');
      await render();
    } catch {
      dialog.state.error =
        'Das Foto konnte nicht gelesen werden. Bitte ein JPEG- oder PNG-Foto oder ein PDF wählen.';
    } finally {
      photoBusy = false;
    }
  }

  /** A PDF goes as it is; its first page is shown and checked like a photo. */
  async function choosePdf(file: File): Promise<void> {
    if (file.size > MAX_BELEG_PDF_BYTES) {
      dialog.state.fields.photo =
        'Das PDF ist zu groß (höchstens 5 MB). Bitte ein kleineres PDF oder ein Foto des Belegs wählen.';
      return;
    }
    try {
      await nextFrame();
      const canvas = await loadPdfPage(file);
      const original = readPixels(canvas, canvas.width, canvas.height);
      const originalBlob = await canvasToJpeg(canvas);
      clearDraft();
      photoWarnings = [];
      draft = {
        original,
        originalBlob,
        originalUrl: URL.createObjectURL(originalBlob),
        bild: original,
        quad: null,
        mode: 'original',
        result: null,
        pdf: file,
      };
      dialog.clearField('photo');
      await render();
    } catch {
      dialog.state.error =
        'Das PDF konnte nicht gelesen werden, vielleicht ist es mit einem Passwort geschützt. Bitte ein anderes PDF oder ein Foto des Belegs wählen.';
    }
  }

  /** Computes the photo for the current edits; false if the corners make no crop. */
  async function render(): Promise<boolean> {
    const form = options.form();
    const current = draft;
    if (!current) return false;
    photoBusy = true;
    try {
      await nextFrame();
      let result: Draft['result'];
      if (!isEdited(current)) {
        result = {
          blob: current.originalBlob,
          url: URL.createObjectURL(current.originalBlob),
          width: current.original.width,
          height: current.original.height,
        };
      } else {
        const edited = toCanvas(
          bildBearbeiten(current.bild, current.quad, current.mode, BELEG_PHOTO_EDGE)
        );
        const blob = await canvasToJpeg(edited);
        result = {
          blob,
          url: URL.createObjectURL(blob),
          width: edited.width,
          height: edited.height,
        };
      }
      if (draft !== current) {
        URL.revokeObjectURL(result.url);
        return true;
      }
      if (current.result) URL.revokeObjectURL(current.result.url);
      draft = { ...current, result };
      if (form && !form.id && !imPruefen) {
        // Only check once the edits have settled
        clearTimeout(checkTimer);
        geplant = () => checkNewPhoto(result.blob, current.bild);
        checkTimer = setTimeout(() => void pruefen(), 1000);
      }
      return true;
    } catch {
      // E.g. two corners dragged onto the same point
      return false;
    } finally {
      photoBusy = false;
    }
  }

  function setMode(mode: FotoFarben): void {
    if (!draft || draft.pdf || draft.mode === mode || zuschnitt) return;
    draft = { ...draft, mode };
    void render();
  }

  /** Rotates or mirrors the photo; a crop turns with it. */
  function ausrichtenBild(schritt: Ausrichtung): void {
    if (!draft || draft.pdf || zuschnitt) return;
    const { bild, quad } = draft;
    draft = {
      ...draft,
      bild: ausrichten(bild, schritt),
      quad: quad ? eckenAusrichten(quad, bild.width, bild.height, schritt) : null,
    };
    void render();
  }

  /** Back to the photo as it was chosen: uncropped, unturned, with its own colours. */
  function zuruecksetzen(): void {
    if (!draft || !isEdited(draft)) return;
    zuschnittSchliessen();
    offeneDrehung = null;
    scanHint = null;
    draft = { ...draft, bild: draft.original, quad: null, mode: 'original' };
    void render();
  }

  /** Opens the crop tool on the uncropped picture, with the current corners. */
  async function zuschneiden(): Promise<void> {
    const current = draft;
    if (!current || current.pdf || zuschnitt) return;
    photoBusy = true;
    try {
      await nextFrame();
      const blob =
        current.bild === current.original
          ? current.originalBlob
          : await canvasToJpeg(toCanvas(current.bild));
      if (draft !== current) return;
      const { width, height } = current.bild;
      zuschnitt = {
        url: URL.createObjectURL(blob),
        width,
        height,
        quad: current.quad ?? fullFrame(width, height),
      };
    } finally {
      photoBusy = false;
    }
  }

  function setZuschnitt(quad: Quad): void {
    if (zuschnitt) zuschnitt = { ...zuschnitt, quad };
  }

  function zuschnittSchliessen(): void {
    if (zuschnitt) URL.revokeObjectURL(zuschnitt.url);
    zuschnitt = null;
  }

  /** Closes the crop tool without its corners; a turn upright that waited for it follows. */
  function zuschnittAbbrechen(): void {
    zuschnittSchliessen();
    if (offeneDrehungAnwenden()) void render();
  }

  /**
   * Turns the photo by the direction that came while the crop tool was open, unless it was
   * turned or mirrored since. Renders nothing; true if it turned.
   */
  function offeneDrehungAnwenden(): boolean {
    const offen = offeneDrehung;
    offeneDrehung = null;
    if (!offen || !draft || draft.bild !== offen.bild) return false;
    draft = gedreht(draft, drehungen(offen.grad));
    return true;
  }

  /** Applies the corners; corners that make no crop keep the tool open with a hint. */
  async function zuschnittFertig(): Promise<void> {
    const current = draft;
    const open = zuschnitt;
    if (!current || !open) return;
    const whole = ganzesBild(open.quad, open.width, open.height);
    draft = { ...current, quad: whole ? null : open.quad };
    scanHint = null;
    const pending = offeneDrehung;
    offeneDrehungAnwenden();
    if (await render()) {
      zuschnittSchliessen();
    } else if (draft) {
      offeneDrehung = pending;
      draft = { ...current, quad: current.quad };
      scanHint = 'Die Ecken bilden kein Viereck. Bitte die Ecken weiter auseinanderziehen.';
    }
  }

  /**
   * The photos for the API: the scan, plus the original if the scan differs from it; for a PDF
   * the PDF and the picture of its first page.
   */
  async function photoPayload(
    current: Draft
  ): Promise<{ photo: string; original?: string; pdf?: string }> {
    const photo = await blobToBase64(current.result!.blob);
    if (current.pdf) return { photo, pdf: await blobToBase64(current.pdf) };
    return isEdited(current)
      ? { photo, original: await blobToBase64(current.originalBlob) }
      : { photo };
  }

  /** Replaces the photo of an existing receipt with the current scan. */
  async function savePhoto(): Promise<void> {
    const form = options.form();
    if (!form?.id || !draft?.result) return;
    const id = form.id;
    photoBusy = true;
    dialog.state.error = null;
    dialog.state.conflict = false;
    options.notice(null);
    try {
      const saved = await sendApi<StaffBeleg>(
        'PUT',
        `/intern/pflege/belege/${id}/foto`,
        await photoPayload(draft),
        {
          etag: form.etag,
        }
      );
      clearDraft();
      photoWarnings = [];
      options.applyPhoto(saved);
      // The dialog stays open, so the confirmation belongs into it.
      options.notice(saved.isPdf ? 'PDF gespeichert.' : 'Foto ersetzt.');
    } catch (error: unknown) {
      dialog.fail(
        error,
        'Das neue Foto oder PDF wurde nicht gespeichert. Prüfe deine Internetverbindung und wähle es noch einmal aus.'
      );
    } finally {
      photoBusy = false;
    }
  }

  /** Starts the planned check now. */
  function pruefen(): Promise<void> {
    clearTimeout(checkTimer);
    const run = geplant;
    geplant = null;
    if (!run) return laufend ?? Promise.resolve();
    const current: Promise<void> = run().finally(() => {
      if (laufend === current) laufend = null;
    });
    laufend = current;
    return current;
  }

  /**
   * Waits until the photo is final before it is submitted: the check of a new photo, which may
   * turn it upright first. A failed check does not hold it up.
   */
  async function fertig(): Promise<void> {
    for (let round = 0; round < 2 && (geplant || laufend); round++) {
      await (geplant ? pruefen() : laufend);
    }
  }

  /** The draft rotated by `schritte`, its crop turned along. */
  function gedreht(current: Draft, schritte: Ausrichtung[]): Draft {
    let { bild, quad } = current;
    for (const schritt of schritte) {
      quad = quad ? eckenAusrichten(quad, bild.width, bild.height, schritt) : null;
      bild = ausrichten(bild, schritt);
    }
    return { ...current, bild, quad };
  }

  /**
   * Turns the photo upright by `grad` and renders it, unless it was turned or mirrored since
   * `bild` was asked about. Returns the photo to check, or null.
   */
  async function aufrichten(
    bild: Pixels,
    grad: 0 | 90 | 180 | 270
  ): Promise<{ blob: Blob; bild: Pixels } | null> {
    const current = draft;
    const schritte = drehungen(grad);
    if (!current || !schritte.length || current.bild !== bild) return null;
    const turned = gedreht(current, schritte);
    draft = turned;
    imPruefen = true;
    try {
      if (!(await render()) || !draft?.result || draft.bild !== turned.bild) return null;
    } finally {
      imPruefen = false;
    }
    return { blob: draft.result.blob, bild: turned.bild };
  }

  /**
   * Checks the photo for a new receipt and prefills the form. A new photo is first turned
   * upright: a quick question for the direction, then the check of the upright photo, which is
   * quicker and more reliable than of one lying sideways.
   */
  async function checkNewPhoto(blob: Blob, bild: Pixels): Promise<void> {
    const form = options.form();
    if (!form || !draft) return;
    const generation = ++photoGeneration;
    aiNotice = null;
    form.aiCheck = null;
    aiChecking = true;
    try {
      // A PDF is submitted as it is, so its page is not turned
      if (!draft.pdf && aufgerichtet !== draft.original) {
        aufgerichtet = draft.original;
        try {
          const drehung = await sendApi<{ available: boolean; rotation: 0 | 90 | 180 | 270 }>(
            'POST',
            '/intern/pflege/belege/pruefung?nur=drehung',
            blob
          );
          if (generation !== photoGeneration) return;
          if (!drehung.available) return;
          if (zuschnitt && drehung.rotation) {
            // Turned once the crop tool closes, then checked upright
            offeneDrehung = { bild, grad: drehung.rotation };
            return;
          }
          const upright = await aufrichten(bild, drehung.rotation);
          if (generation !== photoGeneration) return;
          if (upright) ({ blob, bild } = upright);
        } catch {
          // Without the direction the photo is checked as it is
          if (generation !== photoGeneration) return;
        }
      }
      const result = await sendApi<{ available: boolean; check: BelegCheck | null }>(
        'POST',
        '/intern/pflege/belege/pruefung',
        blob
      );
      if (generation !== photoGeneration || options.form() !== form || form.id) return;
      const check = result.check;
      if (!result.available || !check) return;
      form.aiCheck = check;
      if (!form.shop.trim() && check.shop) form.shop = check.shop;
      if (check.date && form.date === todayIso() && check.date <= todayIso())
        form.date = check.date;
      if (!form.amount.trim() && check.amountCent) form.amount = centToInput(check.amountCent);
    } catch (error: unknown) {
      if (generation !== photoGeneration) return;
      aiNotice = errorMessage(
        error,
        'Das Foto konnte nicht automatisch gelesen werden. Trag die Angaben selbst ein.'
      );
    } finally {
      if (generation === photoGeneration) aiChecking = false;
    }
  }

  function reset(): void {
    clearDraft();
    photoWarnings = [];
    photoGeneration++;
    aiChecking = false;
    aiNotice = null;
  }

  return {
    get photoBusy() {
      return photoBusy;
    },
    get draft() {
      return draft;
    },
    get scanHint() {
      return scanHint;
    },
    get zuschnitt() {
      return zuschnitt;
    },
    get edited() {
      return draft ? isEdited(draft) : false;
    },
    get photoWarnings() {
      return photoWarnings;
    },
    get aiChecking() {
      return aiChecking;
    },
    get aiNotice() {
      return aiNotice;
    },
    choosePhoto,
    clearDraft,
    setMode,
    ausrichten: ausrichtenBild,
    zuruecksetzen,
    zuschneiden,
    setZuschnitt,
    zuschnittFertig,
    zuschnittAbbrechen,
    savePhoto,
    photoPayload,
    fertig,
    reset,
  };
}
