<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import AbstimmungAuswahl from './AbstimmungAuswahl.svelte';
  import AbstimmungErgebnisListe from './AbstimmungErgebnisListe.svelte';
  import AbstimmungLinkKopieren from './AbstimmungLinkKopieren.svelte';
  import { ApiError, errorMessage, postApi, sendApi } from '../../lib/api';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { AbstimmungAnsicht, AbstimmungLink } from '../../lib/abstimmungen';
  import { parseAbstimmungHash } from '../../lib/abstimmungen';

  /**
   * The Abstimmung behind a link without login: the shared link asks for a name, the personal
   * link from the invitation (or the one the page switches to after the first answer) changes
   * that person's answer.
   */

  let link = $state<AbstimmungLink | null>(null);
  let ansicht = $state<AbstimmungAnsicht | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let name = $state('');
  let gewaehlt = $state<number[]>([]);
  let gespeichert = $state<string | null>(null);
  let saving = $state(false);
  let fields = $state<Record<string, string>>({});
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  /** Shown once after the first answer over the shared link. */
  let eigenerLink = $state<string | null>(null);

  const snapshot = $derived(JSON.stringify({ name: name.trim(), gewaehlt }));
  const dirty = $derived(gespeichert !== null && gespeichert !== snapshot);

  async function load(): Promise<void> {
    if (!link) return;
    loading = true;
    loadError = null;
    try {
      ansicht = await postApi<AbstimmungAnsicht>('/abstimmungen/ansehen', link);
      name = ansicht.ich?.name ?? name;
      gewaehlt = ansicht.ich?.gewaehlt ?? [];
      gespeichert = ansicht.ich?.geantwortet ? JSON.stringify({ name: name.trim(), gewaehlt }) : '';
    } catch (failure: unknown) {
      loadError = errorMessage(
        failure,
        'Die Abstimmung konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
      );
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    link = parseAbstimmungHash(window.location.hash);
    if (link) void load();
    else loading = false;
    return guardUnsavedChanges(() => dirty);
  });

  async function save(): Promise<void> {
    if (!link || !ansicht || saving) return;
    fields = name.trim() ? {} : { name: 'Bitte gib deinen Namen ein.' };
    if (fields.name) {
      await tick();
      document.getElementById('abstimmung-name')?.focus();
      return;
    }
    saving = true;
    message = null;
    const erste = !link.token;
    try {
      const { token } = await sendApi<{ token: string }>('PUT', '/abstimmungen/stimme', {
        ...link,
        name,
        gewaehlt,
      });
      if (erste) {
        // From now on this page is the personal link: reloading or a bookmark keeps the answer
        link = { token };
        history.replaceState(history.state, '', `${window.location.pathname}#t=${token}`);
        eigenerLink = window.location.href;
      }
      messageKind = 'success';
      message = 'Antwort gespeichert.';
      await load();
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.fields) fields = failure.fields;
      messageKind = 'error';
      message = errorMessage(
        failure,
        'Deine Antwort wurde nicht gespeichert. Deine Auswahl ist noch da. Tippe noch einmal auf „Antwort speichern“.'
      );
    } finally {
      saving = false;
    }
  }
</script>

{#if loading}
  <div role="status" aria-live="polite" class="space-y-3">
    <span class="sr-only">Abstimmung wird geladen …</span>
    <div class="skeleton-element h-8 w-72 max-w-full rounded"></div>
    <div class="skeleton-element h-40 w-full rounded"></div>
  </div>
{:else if !link}
  <p class="text-neutral-800">
    Dieser Link ist unvollständig. Bitte öffne den vollständigen Link aus deiner Einladung.
  </p>
{:else if loadError || !ansicht}
  <p class="border-l-4 border-l-danger py-1 pl-3 text-neutral-800" role="alert">{loadError}</p>
{:else}
  <div class="max-w-2xl space-y-8">
    <section aria-labelledby="abstimmung-heading">
      <h2
        id="abstimmung-heading"
        class="font-serif text-2xl font-semibold text-brand-900 [overflow-wrap:anywhere] md:text-3xl"
      >
        {ansicht.titel}
      </h2>
      <p class="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
        {#if ansicht.geschlossen}<StatusLabel label="Beendet" />{/if}
        <span>Von {ansicht.erstelltVonName}</span>
      </p>
      {#if ansicht.beschreibung}
        <p class="mt-3 whitespace-pre-line text-neutral-800 [overflow-wrap:anywhere]">
          {ansicht.beschreibung}
        </p>
      {/if}
    </section>

    {#if ansicht.geschlossen}
      <p class="border-l-4 border-l-warning py-1 pl-3 text-neutral-800">
        Diese Abstimmung ist beendet. Du kannst nicht mehr abstimmen.
      </p>
    {:else}
      <form
        class="space-y-5"
        onsubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormField id="abstimmung-name" label="Dein Name" error={fields.name}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              autocomplete="name"
              maxlength="100"
              placeholder="z. B. Lea Muster"
              bind:value={name}
              oninput={() => (fields = {})}
            />
          {/snippet}
        </FormField>
        <AbstimmungAuswahl
          id="abstimmung-public"
          optionen={ansicht.optionen}
          mehrfach={ansicht.mehrfach}
          bind:gewaehlt
          disabled={saving}
        />
        {#if fields.gewaehlt}
          <p class="text-sm text-danger" role="alert">{fields.gewaehlt}</p>
        {/if}
        <div class="flex flex-wrap items-center gap-3">
          <ActionButton type="submit" variant="primary" disabled={saving} aria-busy={saving}
            >{saving ? 'Wird gespeichert …' : 'Antwort speichern'}</ActionButton
          >
          {#if ansicht.ich?.geantwortet && !dirty}
            <StatusLabel label="Du hast abgestimmt" tone="success" />
          {/if}
        </div>
      </form>
    {/if}

    <StatusNotice {message} kind={messageKind} popup />
    {#if eigenerLink}
      <div class="border-l-4 border-l-success py-1 pl-3">
        <p class="text-sm text-neutral-800">
          Mit diesem Link kannst du deine Antwort später ändern. Speichere ihn dir am besten als
          Lesezeichen.
        </p>
        <div class="mt-2">
          <AbstimmungLinkKopieren url={eigenerLink} label="Dein Link" />
        </div>
      </div>
    {/if}

    <AbstimmungErgebnisListe id="abstimmung-public-ergebnis" ergebnis={ansicht} />
  </div>
{/if}
