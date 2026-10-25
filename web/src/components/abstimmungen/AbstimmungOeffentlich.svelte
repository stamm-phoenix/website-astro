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
  import { confirmAction } from '../../lib/confirm';
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

  /**
   * Key of a new answer, sent with every try: if a response gets lost and the answer is sent
   * again, the server finds the person it added before.
   */
  let versuch = crypto.randomUUID();

  /** Counts the loads, so the answer for a link opened before never replaces a newer one. */
  let loads = 0;

  async function load(): Promise<void> {
    if (!link) return;
    const current = ++loads;
    loading = true;
    loadError = null;
    try {
      const loaded = await postApi<AbstimmungAnsicht>('/abstimmungen/ansehen', link);
      if (current !== loads) return;
      ansicht = loaded;
      name = loaded.ich?.name ?? name;
      gewaehlt = loaded.ich?.gewaehlt ?? [];
      gespeichert = JSON.stringify({ name: name.trim(), gewaehlt });
    } catch (failure: unknown) {
      if (current !== loads) return;
      loadError = errorMessage(
        failure,
        'Die Abstimmung konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
      );
    } finally {
      if (current === loads) loading = false;
    }
  }

  /** Opens the link in the address bar; another link in the same tab is another person. */
  function openLink(): void {
    link = parseAbstimmungHash(window.location.hash);
    ansicht = null;
    name = '';
    gewaehlt = [];
    gespeichert = null;
    message = null;
    eigenerLink = null;
    fields = {};
    versuch = crypto.randomUUID();
    if (link) void load();
    else loading = false;
  }

  async function hashChanged(event: HashChangeEvent): Promise<void> {
    const next = parseAbstimmungHash(new URL(event.newURL).hash);
    if (next?.token === link?.token && next?.link === link?.link) return;
    if (dirty) {
      // The address bar shows the new link already; keep the old one until the choice is made
      const neu = window.location.hash;
      history.replaceState(history.state, '', new URL(event.oldURL).hash || '#');
      const confirmed = await confirmAction({
        title: 'Anderen Link öffnen?',
        message: 'Deine Antwort hier ist noch nicht gespeichert und geht verloren.',
        confirmLabel: 'Anderen Link öffnen',
      });
      if (!confirmed) return;
      history.replaceState(history.state, '', neu);
    }
    openLink();
  }

  onMount(() => {
    openLink();
    const listener = (event: HashChangeEvent): void => void hashChanged(event);
    window.addEventListener('hashchange', listener);
    const unguard = guardUnsavedChanges(() => dirty);
    return () => {
      window.removeEventListener('hashchange', listener);
      unguard();
    };
  });

  /** On a link that already has an answer, another name saves a new person. */
  const anderePerson = $derived(
    !!ansicht?.ich?.geantwortet &&
      !!name.trim() &&
      name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de') !==
        ansicht.ich.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
  );

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
    try {
      const { token } = await sendApi<{ token: string }>('PUT', '/abstimmungen/stimme', {
        ...link,
        name,
        gewaehlt,
        versuch,
      });
      // The shared link, or a family link that already had someone else's answer
      if (token !== link.token) {
        // The next new answer on this page is another one
        versuch = crypto.randomUUID();
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
        {#if anderePerson && ansicht.ich}
          <p class="border-l-4 border-l-warning py-1 pl-3 text-sm text-neutral-800">
            Du stimmst als neue Person ab. Die Antwort von {ansicht.ich.name} bleibt erhalten.
          </p>
        {/if}
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
