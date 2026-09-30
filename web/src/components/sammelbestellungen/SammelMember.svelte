<script lang="ts">
  import { onMount } from 'svelte';
  import ArtikelEditor from './ArtikelEditor.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { postApi, sendApi, ApiError } from '../../lib/api';
  import type { SammelAktion, SammelArtikel, SammelMemberView } from '../../lib/types';

  let kind = $state('');
  let id = $state('');
  let token = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);
  let campaign = $state<SammelAktion | null>(null);
  let view = $state<SammelMemberView | null>(null);
  let email = $state('');
  let name = $state('');
  let notes = $state('');
  let website = $state('');
  let items = $state<SammelArtikel[]>([]);
  let fields = $state<Record<string, string>>({});
  const canEdit = $derived(view?.canEdit === true);
  const formatDate = (date: string): string =>
    new Date(date).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const money = (cents: number): string =>
    (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  function fail(caught: unknown): void {
    error =
      caught instanceof Error
        ? caught.message
        : 'Das hat nicht geklappt. Bitte versuche es erneut.';
    fields = caught instanceof ApiError ? (caught.fields ?? {}) : {};
  }
  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      if (kind === 'campaign') {
        campaign = await postApi<SammelAktion>('/sammelbestellungen/campaign', { id, token });
      } else if (kind === 'order') {
        view = await postApi<SammelMemberView>('/sammelbestellungen/order', { id, token });
        campaign = view.campaign;
        name = view.order.name;
        notes = view.order.notes;
        items = view.order.items.map((item) => ({ ...item }));
      } else
        throw new Error(
          'Öffne den Link aus der CampFlow-Mail oder deinen persönlichen Bestelllink.'
        );
    } catch (caught) {
      fail(caught);
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    // Fragments never reach the server or Referer header. Keep them for reloads and bookmarks.
    const readLink = (): void => {
      let fragment = window.location.hash.slice(1);
      try {
        if (!new URLSearchParams(fragment).has('kind'))
          fragment = sessionStorage.getItem('sammelbestellung-link') ?? fragment;
        else sessionStorage.setItem('sammelbestellung-link', fragment);
      } catch {
        /* The email link still works when browser storage is disabled. */
      }
      const params = new URLSearchParams(fragment);
      kind = params.get('kind') ?? '';
      id = params.get('id') ?? '';
      token = params.get('token') ?? '';
      campaign = null;
      view = null;
      message = null;
      fields = {};
      void load();
    };
    readLink();
    const hashChanged = (): void => {
      if (new URLSearchParams(window.location.hash.slice(1)).has('kind')) readLink();
    };
    window.addEventListener('hashchange', hashChanged);
    return () => window.removeEventListener('hashchange', hashChanged);
  });
  async function requestLink(): Promise<void> {
    busy = true;
    error = null;
    message = null;
    fields = {};
    try {
      await postApi('/sammelbestellungen/request-link', { id, token, email, website });
      message =
        'Dein persönlicher Bestelllink kommt per E-Mail. Schau auch im Spam-Ordner nach. Ein weiterer Link kann nach 15 Minuten angefordert werden.';
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  }
  async function save(): Promise<void> {
    if (!view) return;
    busy = true;
    error = null;
    message = null;
    fields = {};
    try {
      await sendApi('PUT', '/sammelbestellungen/order', {
        id,
        token,
        etag: view.order.etag,
        name,
        notes,
        items,
      });
      await load();
      if (!error) message = 'Deine Bestellung wurde gespeichert.';
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  }
</script>

{#if loading}
  <p role="status" aria-live="polite" class="surface p-6">Sammelbestellung wird geladen …</p>
{:else if campaign}
  <section
    aria-labelledby="campaign-heading"
    class="surface mb-6 border-t-4 border-t-[var(--color-dpsg-red)] p-5 sm:p-8"
  >
    <p class="badge">Rüsthaus · Sammelbestellung</p>
    <h2 id="campaign-heading" class="mt-3 font-serif text-2xl text-brand-900 sm:text-3xl">
      {campaign.title}
    </h2>
    <p class="mt-3 whitespace-pre-line text-neutral-700">{campaign.description}</p>
    <p class="mt-4 font-semibold text-brand-900">
      Bestellzeitraum: {formatDate(campaign.startsAt)} bis {formatDate(campaign.endsAt)} Uhr
    </p>
  </section>
  {#if kind === 'campaign'}
    <form
      class="surface max-w-xl space-y-5 p-5 sm:p-8"
      onsubmit={(event) => {
        event.preventDefault();
        void requestLink();
      }}
    >
      <h2 class="font-serif text-xl text-brand-900">Dein Zugang zur Bestellung</h2>
      <p class="text-sm text-neutral-700">
        Du brauchst kein Konto. Wir schicken dir einen persönlichen Link an deine E-Mail-Adresse.
        Pro E-Mail-Adresse ist eine Bestellung möglich; Artikel für Geschwister kannst du gemeinsam
        eintragen.
      </p>
      <FormField id="order-email" label="E-Mail-Adresse" error={fields.email}>
        {#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            type="email"
            required
            maxlength="254"
            autocomplete="email"
            bind:value={email}
            disabled={busy}
          />{/snippet}
      </FormField>
      <div class="hidden" aria-hidden="true">
        <label for="order-website">Website</label><input
          id="order-website"
          tabindex="-1"
          autocomplete="off"
          bind:value={website}
        />
      </div>
      <p class="text-xs text-neutral-700">
        Deine Angaben werden zur Abwicklung der Sammelbestellung verwendet. <a
          class="underline"
          href="/impressum">Datenschutz</a
        >
      </p>
      <button class="btn-primary" disabled={busy} aria-busy={busy}
        >{busy ? 'Wird gesendet …' : 'Bestelllink per E-Mail erhalten'}</button
      >
    </form>
  {:else if view}
    <div class="mb-6 grid gap-3 sm:grid-cols-3">
      <div class="surface p-4">
        <p class="text-sm text-neutral-700">Bestellstatus</p>
        <p class="mt-1 font-semibold text-brand-900">
          {view.order.submitted ? view.order.status : 'Noch nicht abgegeben'}
        </p>
      </div>
      <div class="surface p-4">
        <p class="text-sm text-neutral-700">Bezahlung</p>
        <p class="mt-1 font-semibold text-brand-900">
          {view.order.paid ? 'Bezahlt' : 'Noch offen'}{view.order.totalCents !== null
            ? ` · ${money(view.order.totalCents)}`
            : ''}
        </p>
      </div>
      <div class="surface p-4">
        <p class="text-sm text-neutral-700">Auslieferung</p>
        <p class="mt-1 font-semibold text-brand-900">
          {view.order.delivered ? 'Ausgeliefert' : 'Noch nicht ausgeliefert'}
        </p>
      </div>
    </div>
    {#if !canEdit}<p
        class="mb-6 rounded-lg border border-neutral-200 bg-white p-4 text-neutral-700"
      >
        Diese Bestellung kann nicht mehr geändert werden. Bei Fragen wende dich an das Leitungsteam.
      </p>{/if}
    <form
      class="space-y-6"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canEdit || busy} class="surface grid gap-4 p-5 sm:grid-cols-2">
        <FormField id="order-name" label="Name" error={fields.name}>
          {#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              required
              maxlength="200"
              autocomplete="name"
              bind:value={name}
            />{/snippet}
        </FormField>
        <div>
          <p class="form-label">E-Mail-Adresse</p>
          <p class="pt-2 text-neutral-700">{view.order.email}</p>
        </div>
      </fieldset>
      <ArtikelEditor bind:items catalog={campaign.catalog} disabled={!canEdit || busy} />
      <FormField id="order-notes" label="Bemerkungen" optional error={fields.notes}>
        {#snippet children(attrs)}<textarea
            {...attrs}
            class="form-input"
            rows="3"
            maxlength="2000"
            disabled={!canEdit || busy}
            bind:value={notes}></textarea>{/snippet}
      </FormField>
      {#if canEdit}<button class="btn-primary" disabled={busy || !items.length} aria-busy={busy}
          >{busy
            ? 'Wird gespeichert …'
            : view.order.submitted
              ? 'Änderungen speichern'
              : 'Bestellung abgeben'}</button
        >{/if}
    </form>
  {/if}
{/if}
{#if error}<div
    role="alert"
    class="mt-5 rounded-lg border border-[var(--color-dpsg-red)]/30 bg-white p-4 text-[var(--color-dpsg-red)]"
  >
    <p>{error}</p>
    {#each Object.values(fields) as field, fieldIndex (fieldIndex)}<p class="mt-1 text-sm">
        {field}
      </p>{/each}{#if kind === 'order' && view}<button
        class="btn-secondary mt-3"
        disabled={busy}
        onclick={() => void load()}>Bestellung neu laden</button
      >{/if}
  </div>{/if}
<StatusNotice {message} class="mt-5" />
