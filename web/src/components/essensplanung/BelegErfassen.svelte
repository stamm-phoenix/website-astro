<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import BelegAiCheck from '../pflege/BelegAiCheck.svelte';
  import BelegFotoEntwurf from '../pflege/BelegFotoEntwurf.svelte';
  import BelegFotoPruefung from '../pflege/BelegFotoPruefung.svelte';
  import BezahltVonFeld from './BezahltVonFeld.svelte';
  import { ApiError } from '../../lib/api';
  import { parseEuroToCent } from '../../lib/belege';
  import { createBelegPhotoDraft, type BelegFotoForm } from '../../lib/belegPhotoDraft.svelte';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { todayIso } from '../../lib/format';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { confirmAction } from '../../lib/confirm';
  import type { PlanungAnsicht, PlanungBeleg } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * Enters a receipt: with a photo (the same upload, editing and check as the Belege of the
   * Leitendenbereich) or by hand. With `beleg` it only adds, replaces or removes its photo.
   */

  interface Props {
    kontext: PlanKontext;
    /** A stored receipt whose photo is changed; null for a new one. */
    beleg?: PlanungBeleg | null;
    /** Starts without the photo, for a receipt typed in by hand. */
    ohneFoto?: boolean;
    /** Opens the camera or file choice right away, saving a tap. */
    sofortWaehlen?: boolean;
    onfertig: () => void;
  }
  let {
    kontext,
    beleg = null,
    ohneFoto = false,
    sofortWaehlen = false,
    onfertig,
  }: Props = $props();
  let dateiFeld = $state<HTMLInputElement | null>(null);
  onMount(() => {
    if (sofortWaehlen && !ohneFoto) dateiFeld?.click();
  });

  const ich = $derived(kontext.ansicht.mitglieder.find((m) => m.ich) ?? null);
  const form = $state<BelegFotoForm>({
    id: untrack(() => (beleg ? String(beleg.id) : null)),
    etag: untrack(() => beleg?.etag ?? ''),
    shop: '',
    date: todayIso(),
    amount: '',
    aiCheck: null,
  });
  let notiz = $state('');
  let wahl = $state(untrack(() => (ich ? `m:${ich.id}` : 'text')));
  let name = $state('');
  let erstattet = $state(false);
  let mitFoto = $state(untrack(() => !ohneFoto));

  const dialog = createDialogForm();
  const photo = createBelegPhotoDraft({
    form: () => form,
    dialog,
    notice: () => undefined,
    applyPhoto: () => undefined,
    pruefung: untrack(() => kontext.api.belegPruefung),
  });
  const fehler = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy || kontext.busy);
  const bearbeiten = $derived(kontext.ansicht.zugang !== 'lesen' && !kontext.ansicht.wartung);

  const geaendert = $derived(
    photo.draft !== null ||
      (!beleg && (form.shop.trim() !== '' || form.amount.trim() !== '' || notiz.trim() !== ''))
  );
  $effect(() => guardUnsavedChanges(() => geaendert));
  $effect(() => () => photo.reset());

  function felderPruefen(): Record<string, string> {
    const fields: Record<string, string> = {};
    if (parseEuroToCent(form.amount) === null)
      fields.betragCent = 'Bitte einen Betrag größer als 0 € angeben, z. B. 12,34.';
    if (!form.date) fields.datum = 'Bitte ein gültiges Datum angeben.';
    if (wahl === 'text' && !name.trim()) fields.bezahltVonText = 'Bitte angeben, wer bezahlt hat.';
    if (mitFoto && photo.zuschnitt)
      fields.photo = 'Bitte erst „Zuschneiden fertig“ oder „Abbrechen“ wählen.';
    else if (mitFoto && photo.draft && !photo.draft.result)
      fields.photo = 'Das Foto wird noch verarbeitet.';
    return fields;
  }

  /** Set at once on a click, before anything is awaited, so a second click saves nothing twice. */
  let laeuft = false;

  /** Runs one save at a time; the buttons stay locked until it is over. */
  async function exklusiv(work: () => Promise<void>): Promise<void> {
    if (laeuft) return;
    laeuft = true;
    dialog.state.busy = true;
    try {
      await work();
    } finally {
      laeuft = false;
      dialog.state.busy = false;
    }
  }

  /** Runs a save; field messages of the server show at their fields. */
  async function senden(work: () => Promise<PlanungAnsicht>, erfolg: string): Promise<boolean> {
    let felder: Record<string, string> = {};
    const ok = await kontext.aendern(async () => {
      try {
        return await work();
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields) felder = error.fields;
        throw error;
      }
    }, erfolg);
    dialog.state.fields = felder;
    return ok;
  }

  function speichern(): Promise<void> {
    return exklusiv(speichernJetzt);
  }

  async function speichernJetzt(): Promise<void> {
    if (dialog.invalid(felderPruefen())) return;
    // The check may still turn the photo upright; the saved photo is the final one
    await photo.fertig();
    const fotos = mitFoto && photo.draft?.result ? await photo.photoPayload(photo.draft) : {};
    const mitglied = wahl.startsWith('m:') ? Number(wahl.slice(2)) : null;
    const ok = await senden(
      () =>
        kontext.api.senden('POST', '/belege', {
          datum: form.date,
          betragCent: parseEuroToCent(form.amount),
          haendler: form.shop,
          notiz,
          bezahltVonId: mitglied,
          bezahltVonText: mitglied === null ? name : '',
          erstattet,
          ...fotos,
        }),
      'Beleg gespeichert.'
    );
    if (!ok) return;
    photo.reset();
    form.shop = '';
    form.amount = '';
    form.aiCheck = null;
    notiz = '';
    erstattet = false;
    onfertig();
  }

  function fotoSpeichern(): Promise<void> {
    return exklusiv(fotoSpeichernJetzt);
  }

  async function fotoSpeichernJetzt(): Promise<void> {
    if (!beleg || !photo.draft?.result || photo.zuschnitt) return;
    await photo.fertig();
    const payload = await photo.photoPayload(photo.draft);
    const id = beleg.id;
    const ok = await senden(
      () => kontext.api.senden('PUT', `/belege/${id}/foto`, { etag: beleg!.etag, ...payload }),
      'Foto gespeichert.'
    );
    if (ok) {
      photo.reset();
      onfertig();
    }
  }

  async function fotoEntfernen(): Promise<void> {
    if (!beleg) return;
    const { id, etag } = beleg;
    if (
      !(await confirmAction({
        title: 'Foto des Belegs entfernen?',
        message: 'Der Beleg bleibt eingetragen, nur ohne Foto.',
        confirmLabel: 'Foto entfernen',
      }))
    )
      return;
    await exklusiv(async () => {
      const ok = await senden(
        () => kontext.api.senden('DELETE', `/belege/${id}/foto`, undefined, etag),
        'Foto entfernt.'
      );
      if (ok) onfertig();
    });
  }

  /** Whether something typed or photographed would get lost. */
  export function ungespeichert(): boolean {
    return geaendert;
  }

  /** Adds a photo to the receipt being typed in and opens the camera or file choice. */
  export async function zuFoto(): Promise<void> {
    mitFoto = true;
    await tick();
    dateiFeld?.click();
  }

  /** Goes on without the photo, after asking if one is chosen; false if it stays. */
  export async function zuOhneFoto(): Promise<boolean> {
    if (
      photo.draft &&
      !(await confirmAction({
        title: 'Foto verwerfen?',
        message: 'Die eingetragenen Angaben bleiben, nur das Foto geht.',
        confirmLabel: 'Foto verwerfen',
      }))
    )
      return false;
    photo.reset();
    mitFoto = false;
    return true;
  }

  const titel = $derived(
    beleg ? (beleg.foto ? 'Foto ersetzen' : 'Foto hinzufügen') : 'Neuer Beleg'
  );
</script>

<section
  aria-labelledby="beleg-erfassen-titel"
  class="space-y-3 border border-neutral-200 bg-[var(--color-surface)] p-3"
>
  <h3 id="beleg-erfassen-titel" class="font-semibold text-brand-900">{titel}</h3>
  <div
    class="grid gap-4 {mitFoto && !beleg ? 'md:grid-cols-[minmax(0,34rem)_minmax(0,24rem)]' : ''}"
  >
    {#if mitFoto}
      <div class="min-w-0 space-y-2">
        <BelegFotoEntwurf {photo} {busy} />
        <div class="flex flex-wrap gap-2">
          <label
            class="btn-secondary min-h-9 cursor-pointer any-pointer-coarse:min-h-11"
            class:opacity-60={photo.photoBusy}
          >
            {photo.photoBusy
              ? 'Wird verarbeitet …'
              : photo.draft
                ? 'Anderes Foto oder PDF wählen'
                : 'Foto aufnehmen oder Datei wählen'}
            <input
              bind:this={dateiFeld}
              type="file"
              accept="image/*,application/pdf"
              class="sr-only"
              disabled={photo.photoBusy || busy || !bearbeiten}
              onchange={photo.choosePhoto}
            />
          </label>
          {#if !beleg}
            <ActionButton
              class="min-h-9 any-pointer-coarse:min-h-11"
              disabled={busy}
              onclick={() => void zuOhneFoto()}>Ohne Foto</ActionButton
            >
          {/if}
        </div>
        <BelegAiCheck
          isNew={!beleg}
          kasse={false}
          check={form.aiCheck}
          warnings={photo.photoWarnings}
        />
        <BelegFotoPruefung {photo} />
        {#if fehler.photo}<p class="text-sm text-danger">{fehler.photo}</p>{/if}
        {#if dialog.state.error}<p class="text-sm text-danger">{dialog.state.error}</p>{/if}
      </div>
    {/if}

    {#if !beleg}
      <form
        class="grid content-start gap-x-3 gap-y-2 {mitFoto
          ? ''
          : 'sm:grid-cols-2 lg:grid-cols-[9rem_8rem_minmax(0,1fr)_minmax(0,16rem)_minmax(0,1fr)]'}"
        onsubmit={(event) => {
          event.preventDefault();
          void speichern();
        }}
      >
        <!-- Locked while saving: what is sent is what was typed, nothing typed meanwhile gets lost -->
        <fieldset class="contents" disabled={dialog.state.busy}>
          <label class="block text-sm">
            <span class="form-label">Datum</span>
            <input
              type="date"
              class="form-input mt-0.5 min-h-9 px-2 py-1 text-sm any-pointer-coarse:min-h-11"
              bind:value={form.date}
              max={todayIso()}
              required
              aria-invalid={fehler.datum ? 'true' : undefined}
            />
            {#if fehler.datum}<span class="text-xs text-danger">{fehler.datum}</span>{/if}
          </label>
          <label class="block text-sm">
            <span class="form-label">Betrag in €</span>
            <input
              type="text"
              inputmode="decimal"
              class="form-input mt-0.5 min-h-9 px-2 py-1 text-right text-sm any-pointer-coarse:min-h-11"
              placeholder="12,34"
              bind:value={form.amount}
              aria-invalid={fehler.betragCent ? 'true' : undefined}
            />
            {#if fehler.betragCent}<span class="text-xs text-danger">{fehler.betragCent}</span>{/if}
          </label>
          <label class="block text-sm">
            <span class="form-label">Händler oder was</span>
            <input
              type="text"
              maxlength="100"
              class="form-input mt-0.5 min-h-9 px-2 py-1 text-sm any-pointer-coarse:min-h-11"
              placeholder="z. B. Rewe, Gas für den Kocher"
              bind:value={form.shop}
              aria-invalid={fehler.haendler ? 'true' : undefined}
            />
            {#if fehler.haendler}<span class="text-xs text-danger">{fehler.haendler}</span>{/if}
          </label>
          <div class="text-sm">
            <label class="form-label" for="beleg-neu-bezahlt">Bezahlt von</label>
            <div class="mt-0.5">
              <BezahltVonFeld
                id="beleg-neu-bezahlt"
                mitglieder={kontext.ansicht.mitglieder}
                bind:wahl
                bind:text={name}
                invalid={!!(fehler.bezahltVonText || fehler.bezahltVonId)}
              />
            </div>
            {#if fehler.bezahltVonText || fehler.bezahltVonId}
              <span class="text-xs text-danger">{fehler.bezahltVonText ?? fehler.bezahltVonId}</span
              >
            {/if}
          </div>
          <label class="block text-sm">
            <span class="form-label">Notiz</span>
            <input
              type="text"
              maxlength="500"
              class="form-input mt-0.5 min-h-9 px-2 py-1 text-sm any-pointer-coarse:min-h-11"
              bind:value={notiz}
              aria-invalid={fehler.notiz ? 'true' : undefined}
            />
          </label>
          <div
            class="flex flex-wrap items-center gap-x-4 gap-y-2 {mitFoto
              ? ''
              : 'sm:col-span-2 lg:col-span-5'}"
          >
            <label
              class="inline-flex cursor-pointer items-center gap-2 text-sm any-pointer-coarse:min-h-11"
            >
              <input type="checkbox" class="size-4" bind:checked={erstattet} />
              Schon erstattet
            </label>
            <ActionButton
              type="submit"
              variant="primary"
              class="min-h-9 any-pointer-coarse:min-h-11"
              disabled={busy || photo.photoBusy || !!photo.zuschnitt || !bearbeiten}
              >{dialog.state.busy ? 'Wird gespeichert …' : 'Beleg speichern'}</ActionButton
            >
            {#if !mitFoto}
              <ActionButton
                class="min-h-9 any-pointer-coarse:min-h-11"
                disabled={busy}
                onclick={() => void zuFoto()}>Foto hinzufügen</ActionButton
              >
            {/if}
            <ActionButton
              class="min-h-9 any-pointer-coarse:min-h-11"
              disabled={busy}
              onclick={onfertig}>Abbrechen</ActionButton
            >
          </div>
        </fieldset>
      </form>
    {:else}
      <div class="flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          class="min-h-9 any-pointer-coarse:min-h-11"
          disabled={busy ||
            photo.photoBusy ||
            !photo.draft?.result ||
            !!photo.zuschnitt ||
            !bearbeiten}
          onclick={() => void fotoSpeichern()}>Foto speichern</ActionButton
        >
        {#if beleg.foto}
          <ActionButton
            variant="danger"
            class="min-h-9 any-pointer-coarse:min-h-11"
            disabled={busy || !bearbeiten}
            onclick={() => void fotoEntfernen()}>Foto entfernen</ActionButton
          >
        {/if}
        <ActionButton class="min-h-9 any-pointer-coarse:min-h-11" disabled={busy} onclick={onfertig}
          >Abbrechen</ActionButton
        >
      </div>
    {/if}
  </div>
</section>
