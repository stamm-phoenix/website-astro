import { errorMessage, sendApi } from './api';
import {
  blobToBase64,
  BELEG_PHOTO_EDGE,
  MIN_BELEG_PHOTO_EDGE,
  canvasToJpeg,
  loadPhoto,
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
  /** The photo as it will be submitted. */
  result: { blob: Blob; url: string; width: number; height: number } | null;
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

/** Share of the receipt's size left around a found receipt, so no letter at its edge is cut. */
const RAND = 0.03;

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
  photoPayload: (draft: Draft) => Promise<{ photo: string; original?: string }>;
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
  /** Quality hints for the photo chosen last. */
  let photoWarnings = $state<string[]>([]);
  /** KI-Vorprüfung of the photo chosen for a new receipt. */
  let aiChecking = $state(false);
  let aiNotice = $state<string | null>(null);
  /** Increments per chosen photo, so a late check result of an older photo is ignored. */
  let photoGeneration = 0;
  /** The photo turned upright after its check; each photo is turned at most once on its own. */
  let aufgerichtet: Pixels | null = null;
  /** The next check follows the automatic turn: the result shown so far stays. */
  let stillPruefen = false;

  function clearDraft(): void {
    if (draft) {
      URL.revokeObjectURL(draft.originalUrl);
      if (draft.result) URL.revokeObjectURL(draft.result.url);
    }
    clearTimeout(checkTimer);
    zuschnittAbbrechen();
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
      };
      dialog.clearField('photo');
      await render();
    } catch {
      dialog.state.error =
        'Das Foto konnte nicht gelesen werden. Bitte ein JPEG- oder PNG-Foto wählen.';
    } finally {
      photoBusy = false;
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
      if (form && !form.id) {
        // Only check once the edits have settled
        clearTimeout(checkTimer);
        const still = stillPruefen;
        stillPruefen = false;
        checkTimer = setTimeout(() => void checkNewPhoto(result.blob, current.bild, still), 1000);
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
    if (!draft || draft.mode === mode || zuschnitt) return;
    draft = { ...draft, mode };
    void render();
  }

  /** Rotates or mirrors the photo; a crop turns with it. */
  function ausrichtenBild(schritt: Ausrichtung): void {
    if (!draft || zuschnitt) return;
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
    zuschnittAbbrechen();
    scanHint = null;
    draft = { ...draft, bild: draft.original, quad: null, mode: 'original' };
    void render();
  }

  /** Opens the crop tool on the uncropped picture, with the current corners. */
  async function zuschneiden(): Promise<void> {
    const current = draft;
    if (!current || zuschnitt) return;
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

  function zuschnittAbbrechen(): void {
    if (zuschnitt) URL.revokeObjectURL(zuschnitt.url);
    zuschnitt = null;
  }

  /** Applies the corners; corners that make no crop keep the tool open with a hint. */
  async function zuschnittFertig(): Promise<void> {
    const current = draft;
    const open = zuschnitt;
    if (!current || !open) return;
    const whole = ganzesBild(open.quad, open.width, open.height);
    draft = { ...current, quad: whole ? null : open.quad };
    scanHint = null;
    if (await render()) {
      zuschnittAbbrechen();
    } else if (draft) {
      draft = { ...draft, quad: current.quad };
      scanHint = 'Die Ecken bilden kein Viereck. Bitte die Ecken weiter auseinanderziehen.';
    }
  }

  /** The photos for the API: the scan, plus the original if the scan differs from it. */
  async function photoPayload(current: Draft): Promise<{ photo: string; original?: string }> {
    const photo = await blobToBase64(current.result!.blob);
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
      options.notice('Foto ersetzt.');
    } catch (error: unknown) {
      dialog.fail(
        error,
        'Das Foto wurde nicht ersetzt. Prüfe deine Internetverbindung und wähle es noch einmal aus.'
      );
    } finally {
      photoBusy = false;
    }
  }

  /** Asks the image model about a new photo and prefills empty fields with what it read. */
  /**
   * Turns the photo upright as the check says, unless it was turned or mirrored since, the crop
   * tool is open or it was already turned once. The turned photo is checked again in the
   * background, so submitting finds its check.
   */
  function aufrichten(bild: Pixels, grad: BelegCheck['rotation']): void {
    const current = draft;
    const schritte = drehungen(grad);
    if (!current || !schritte.length || zuschnitt) return;
    if (current.bild !== bild || aufgerichtet === current.original) return;
    aufgerichtet = current.original;
    let { bild: gedreht, quad } = current;
    for (const schritt of schritte) {
      quad = quad ? eckenAusrichten(quad, gedreht.width, gedreht.height, schritt) : null;
      gedreht = ausrichten(gedreht, schritt);
    }
    draft = { ...current, bild: gedreht, quad };
    stillPruefen = true;
    void render();
  }

  /**
   * Checks the photo for a new receipt and prefills the form. `bild` is the orientation that was
   * checked; `still` keeps the result shown so far, after the photo was turned upright.
   */
  async function checkNewPhoto(blob: Blob, bild: Pixels, still = false): Promise<void> {
    const form = options.form();
    if (!form) return;
    const generation = ++photoGeneration;
    aiNotice = null;
    if (!still) {
      form.aiCheck = null;
      aiChecking = true;
    }
    try {
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
      aufrichten(bild, check.rotation);
    } catch (error: unknown) {
      if (generation !== photoGeneration || still) return;
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
    reset,
  };
}
