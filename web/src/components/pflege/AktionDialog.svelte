<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { formatEventRange } from '../../lib/campflowFields';
  import type { AktionTarget } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import RichTextEditor from './RichTextEditor.svelte';

  interface Props {
    target: AktionTarget | null;
    stufen: string[];
    onsaved: (message: string) => void;
    onclose: () => void;
  }

  interface Form {
    title: string;
    start: string;
    end: string;
    link: string;
    stufen: string[];
    description: string;
  }

  let { target, stufen, onsaved, onclose }: Props = $props();

  let form = $state<Form | null>(null);
  let busy = $state(false);
  let errors = $state<Record<string, string>>({});
  let dialogError = $state<string | null>(null);
  let confirmDelete = $state(false);

  const event = $derived(target?.event ?? null);
  const entry = $derived(target?.entry ?? null);
  /** A calendar entry whose CampFlow event no longer exists; saving unlinks it. */
  const orphaned = $derived(!event && !!entry?.campflowId);
  const title = $derived(
    event
      ? entry
        ? 'Kalendereintrag bearbeiten'
        : 'Im öffentlichen Kalender veröffentlichen'
      : entry
        ? 'Aktion bearbeiten'
        : 'Neue Aktion ohne CampFlow'
  );

  $effect(() => {
    // Reset the form whenever another target is opened
    const current = target;
    form = current
      ? {
          title: current.entry?.title ?? '',
          start: current.entry?.start ?? '',
          end: current.entry?.end ?? '',
          link: current.entry?.link ?? '',
          stufen: [...(current.entry?.stufen ?? [])],
          description: current.entry?.description ?? '',
        }
      : null;
    errors = {};
    dialogError = null;
    confirmDelete = false;
  });

  function toggleStufe(stufe: string): void {
    if (!form) return;
    form.stufen = form.stufen.includes(stufe)
      ? form.stufen.filter((s) => s !== stufe)
      : [...form.stufen, stufe];
  }

  function close(): void {
    if (!busy) onclose();
  }

  function handleError(error: unknown, fallback: string): void {
    if (error instanceof ApiError) {
      errors = { ...errors, ...error.fields };
      dialogError =
        error.code === 'CONFLICT'
          ? 'Der Eintrag wurde inzwischen geändert oder die Aktion ist schon veröffentlicht. Deine Eingaben bleiben hier erhalten. Bitte schließe den Dialog und lade die Liste neu.'
          : (error.fields?.campflowId ?? error.fields?.etag ?? error.message);
    } else dialogError = fallback;
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    errors = {};
    dialogError = null;
    if (!event) {
      if (!form.title.trim()) errors.title = 'Bitte einen Titel angeben.';
      if (!form.start) errors.start = 'Bitte ein Startdatum angeben.';
      if (form.end && form.start && form.end < form.start)
        errors.end = 'Das Enddatum darf nicht vor dem Startdatum liegen.';
      if (form.link.trim() && !/^https:\/\//i.test(form.link.trim()))
        errors.link = 'Der Anmeldelink muss mit https:// beginnen.';
    }
    if (form.stufen.length === 0) errors.stufen = 'Bitte mindestens eine Stufe auswählen.';
    const first = ['title', 'start', 'end', 'link', 'stufen'].find((field) => errors[field]);
    if (first) {
      await tick();
      document.getElementById(`aktion-${first}`)?.focus();
      return;
    }

    busy = true;
    const body = {
      ...form,
      stufen: stufen.filter((s) => form!.stufen.includes(s)),
      campflowId: event?.id ?? null,
      etag: entry?.etag,
    };
    try {
      if (entry) await sendApi('PATCH', `/intern/pflege/aktionen/${entry.id}`, body);
      else await sendApi('POST', '/intern/pflege/aktionen', body);
      onsaved(
        entry
          ? 'Kalendereintrag gespeichert. Die Website wird in wenigen Minuten aktualisiert.'
          : 'Aktion veröffentlicht. Sie erscheint in wenigen Minuten im öffentlichen Kalender.'
      );
    } catch (error: unknown) {
      handleError(
        error,
        'Speichern fehlgeschlagen. Bitte prüfe deine Verbindung und versuche es erneut.'
      );
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!entry || busy) return;
    busy = true;
    dialogError = null;
    try {
      await sendApi('DELETE', `/intern/pflege/aktionen/${entry.id}`, undefined, {
        etag: entry.etag,
      });
      onsaved(
        event
          ? 'Die Aktion ist nicht mehr öffentlich. In CampFlow bleibt sie unverändert.'
          : 'Aktion gelöscht. Sie erscheint nicht mehr im öffentlichen Kalender.'
      );
    } catch (error: unknown) {
      handleError(
        error,
        'Löschen fehlgeschlagen. Bitte prüfe deine Verbindung und versuche es erneut.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={target !== null}
  {title}
  {busy}
  error={dialogError}
  submitLabel={entry || !event ? 'Speichern' : 'Veröffentlichen'}
  onsubmit={save}
  onclose={close}
>
  {#if form && target}
    {#if event}
      <div class="rounded-md bg-[var(--color-brand-50)] px-3 py-2 text-sm text-brand-900">
        <p class="font-semibold">{event.title}</p>
        <p class="mt-0.5">{formatEventRange(event)}</p>
        {#if event.url}
          <p class="mt-0.5 break-all">
            Anmeldung: <a href={event.url} target="_blank" rel="noopener noreferrer">{event.url}</a>
          </p>
        {:else}
          <p class="mt-0.5">Kein Anmeldelink in CampFlow.</p>
        {/if}
        <p class="mt-2 text-xs text-neutral-700">
          Titel, Datum und Anmeldelink kommen aus CampFlow und werden dort geändert.
        </p>
      </div>
    {:else if orphaned}
      <p role="note" class="rounded-md bg-[#fff1e0] px-3 py-2 text-sm text-[#8a4a00]">
        Die verknüpfte CampFlow-Aktion gibt es nicht mehr. Beim Speichern wird der Eintrag zu einer
        Aktion ohne CampFlow.
      </p>
    {/if}

    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <legend class="sr-only">Angaben für den öffentlichen Kalender</legend>

      {#if !event}
        <FormField id="aktion-title" label="Titel" error={errors.title}>
          {#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              maxlength="255"
              bind:value={form!.title}
            />{/snippet}
        </FormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="aktion-start" label="Beginn" error={errors.start}>
            {#snippet children(attrs)}<input
                {...attrs}
                type="date"
                class="form-input"
                bind:value={form!.start}
              />{/snippet}
          </FormField>
          <FormField
            id="aktion-end"
            label="Ende"
            optional
            hint="Leer lassen für eintägige Aktionen."
            error={errors.end}
          >
            {#snippet children(attrs)}<input
                {...attrs}
                type="date"
                class="form-input"
                min={form!.start || undefined}
                bind:value={form!.end}
              />{/snippet}
          </FormField>
        </div>
        <FormField
          id="aktion-link"
          label="Anmeldelink"
          optional
          hint="Muss mit https:// beginnen."
          error={errors.link}
        >
          {#snippet children(attrs)}<input
              {...attrs}
              type="url"
              class="form-input"
              maxlength="255"
              placeholder="https://"
              bind:value={form!.link}
            />{/snippet}
        </FormField>
      {/if}

      <fieldset aria-describedby="aktion-stufen-hint{errors.stufen ? ' aktion-stufen-error' : ''}">
        <legend class="form-label">Stufen</legend>
        <div class="mt-1 flex flex-wrap gap-x-4 gap-y-2">
          {#each stufen as stufe, index (stufe)}
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                id={index === 0 ? 'aktion-stufen' : undefined}
                type="checkbox"
                aria-invalid={errors.stufen ? 'true' : undefined}
                checked={form.stufen.includes(stufe)}
                onchange={() => toggleStufe(stufe)}
              />
              {stufe}
            </label>
          {/each}
        </div>
        <p id="aktion-stufen-hint" class="mt-1 text-xs text-neutral-700">
          Aktionen nur für „Leitende“ erscheinen nur im Leitenden-Kalender, nicht auf der Website.
        </p>
        {#if errors.stufen}<p
            id="aktion-stufen-error"
            class="mt-1 text-sm text-[var(--color-dpsg-red)]"
          >
            {errors.stufen}
          </p>{/if}
      </fieldset>

      <div inert={busy}>
        <span id="aktion-description-label" class="form-label">
          Beschreibung <span class="font-normal text-neutral-700">(optional)</span>
        </span>
        <RichTextEditor
          id="aktion-description"
          labelledBy="aktion-description-label"
          describedBy={errors.description
            ? 'aktion-description-hint aktion-description-error'
            : 'aktion-description-hint'}
          invalid={!!errors.description}
          bind:value={form.description}
        />
        <p id="aktion-description-hint" class="mt-1 text-xs text-neutral-700">
          Bis zu 5000 Zeichen. Fett, kursiv und Listen sind möglich.
        </p>
        {#if errors.description}<p
            id="aktion-description-error"
            class="mt-1 text-sm text-[var(--color-dpsg-red)]"
          >
            {errors.description}
          </p>{/if}
      </div>
    </fieldset>
  {/if}

  {#snippet actions()}
    {#if entry}
      {#if confirmDelete}
        <div class="space-y-2">
          <p class="text-sm text-neutral-700">
            {event
              ? 'Aus dem öffentlichen Kalender entfernen? In CampFlow bleibt die Aktion erhalten.'
              : 'Die Aktion endgültig löschen?'}
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-danger" disabled={busy} onclick={remove}
              >{event ? 'Ja, entfernen' : 'Ja, löschen'}</button
            >
            <button
              type="button"
              class="btn-secondary"
              disabled={busy}
              onclick={() => (confirmDelete = false)}>Behalten</button
            >
          </div>
        </div>
      {:else}
        <button
          type="button"
          class="btn-danger"
          disabled={busy}
          onclick={() => (confirmDelete = true)}
          >{event ? 'Nicht mehr veröffentlichen' : 'Löschen'}</button
        >
      {/if}
    {/if}
  {/snippet}
</EditDialog>
