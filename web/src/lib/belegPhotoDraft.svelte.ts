import { errorMessage, sendApi } from './api';
import {
  blobToBase64,
  BELEG_PHOTO_EDGE,
  canvasToJpeg,
  loadPhoto,
  centToInput,
  photoWarnings as measurePhotoWarnings,
} from './belege';
import { todayIso } from './format';
import {
  findReceipt,
  fullFrame,
  isFullFrame,
  readPixels,
  scanReceipt,
  toCanvas,
} from './belegScan';
import type { Pixels, Quad, ScanMode } from './belegScan';
import type { BelegCheck, StaffBeleg } from './types';
import type { BelegForm } from './belegForm';
import type { createDialogForm } from './dialogForm.svelte';
/** `aus`: the photo is used as it is, e.g. because it already is a scan of the phone. */
type Mode = ScanMode | 'aus';

/** A chosen photo while it is being scanned. */
interface Draft {
  original: Pixels;
  originalBlob: Blob;
  originalUrl: string;
  quad: Quad;
  mode: Mode;
  /** Result of the scan (or the original with mode `aus`). */
  result: { blob: Blob; url: string; width: number; height: number } | null;
}

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
  readonly photoWarnings: string[];
  readonly aiChecking: boolean;
  readonly aiNotice: string | null;
  choosePhoto: (event: Event) => Promise<void>;
  clearDraft: () => void;
  setQuad: (quad: Quad) => void;
  setMode: (mode: Mode) => void;
  savePhoto: () => Promise<void>;
  photoPayload: (draft: Draft) => Promise<{ photo: string; original?: string }>;
  reset: () => void;
}
export function createBelegPhotoDraft(options: Options): BelegPhotoDraft {
  const dialog = options.dialog;
  let photoBusy = $state(false);
  let draft = $state.raw<Draft | null>(null);
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

  function clearDraft(): void {
    if (draft) {
      URL.revokeObjectURL(draft.originalUrl);
      if (draft.result) URL.revokeObjectURL(draft.result.url);
    }
    clearTimeout(checkTimer);
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
      photoWarnings = measurePhotoWarnings(canvas);
      const original = readPixels(canvas, canvas.width, canvas.height);
      const originalBlob = await canvasToJpeg(canvas);
      clearDraft();
      const found = findReceipt(original);
      let quad = found ?? fullFrame(original.width, original.height);
      let mode: Mode = 'farbe';
      if (!found) {
        scanHint = 'Ränder nicht erkannt – zieh die Ecken selbst auf den Beleg.';
      } else if (isFullFrame(found, original.width, original.height)) {
        // The photo shows only the receipt, e.g. a scan of the phone camera
        quad = fullFrame(original.width, original.height);
        mode = 'aus';
      }
      draft = {
        original,
        originalBlob,
        originalUrl: URL.createObjectURL(originalBlob),
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

  /** Computes the scan for the current corners and mode. */
  async function render(): Promise<void> {
    const form = options.form();
    const current = draft;
    if (!current) return;
    photoBusy = true;
    try {
      await nextFrame();
      let result: Draft['result'];
      if (current.mode === 'aus') {
        result = {
          blob: current.originalBlob,
          url: URL.createObjectURL(current.originalBlob),
          width: current.original.width,
          height: current.original.height,
        };
      } else {
        const scan = toCanvas(
          scanReceipt(current.original, current.quad, current.mode, BELEG_PHOTO_EDGE)
        );
        const blob = await canvasToJpeg(scan);
        result = { blob, url: URL.createObjectURL(blob), width: scan.width, height: scan.height };
      }
      if (draft !== current) {
        URL.revokeObjectURL(result.url);
        return;
      }
      if (current.result) URL.revokeObjectURL(current.result.url);
      draft = { ...current, result };
      if (form && !form.id) {
        // Only check once the corners have settled
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => void checkNewPhoto(result.blob), 600);
      }
    } catch {
      // E.g. two corners dragged onto the same point; never keep the scan of the old corners
      if (draft === current) {
        if (current.result) URL.revokeObjectURL(current.result.url);
        draft = { ...current, result: null };
        scanHint = 'Die Ecken bilden kein Viereck. Bitte die Ecken weiter auseinanderziehen.';
      }
    } finally {
      photoBusy = false;
    }
  }

  function setQuad(quad: Quad): void {
    if (!draft) return;
    draft = { ...draft, quad };
    void render();
  }

  function setMode(mode: Mode): void {
    if (!draft || draft.mode === mode) return;
    draft = { ...draft, mode };
    void render();
  }

  /** The photos for the API: the scan, plus the original if the scan differs from it. */
  async function photoPayload(current: Draft): Promise<{ photo: string; original?: string }> {
    const photo = await blobToBase64(current.result!.blob);
    return current.mode === 'aus'
      ? { photo }
      : { photo, original: await blobToBase64(current.originalBlob) };
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
  async function checkNewPhoto(blob: Blob): Promise<void> {
    const form = options.form();
    if (!form) return;
    const generation = ++photoGeneration;
    form.aiCheck = null;
    aiNotice = null;
    aiChecking = true;
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
    setQuad,
    setMode,
    savePhoto,
    photoPayload,
    reset,
  };
}
