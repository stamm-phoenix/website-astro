<script lang="ts">
  import { onMount } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import AltchaWidget from '../AltchaWidget.svelte';
  import { ApiError, errorMessage, postApi } from '../../lib/api';
  import {
    planungUrl,
    vergiss,
    zuletztGeoeffnet,
    type ZuletztGeoeffnet,
  } from '../../lib/essensplanung';

  /**
   * Start page of the Essensplanung: create a Planung (confirmed by mail), get the links of one's
   * Planungen by mail, and the Planungen opened on this device.
   */

  let zuletzt = $state<ZuletztGeoeffnet[]>([]);
  onMount(() => {
    zuletzt = zuletztGeoeffnet();
  });

  // Create
  let email = $state('');
  let name = $state('');
  let planungName = $state('');
  let ersterTag = $state('');
  let letzterTag = $state('');
  let anlegenFehler = $state<Record<string, string>>({});
  let anlegenBusy = $state(false);
  let anlegenMeldung = $state<string | null>(null);
  let anlegenArt = $state<'success' | 'error'>('success');
  let anlegenVorschau = $state<string | null>(null);
  let anlegenAltcha = $state<AltchaWidget | null>(null);

  async function anlegen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (anlegenBusy) return;
    anlegenBusy = true;
    anlegenFehler = {};
    anlegenMeldung = null;
    anlegenVorschau = null;
    try {
      const altcha = await anlegenAltcha?.solve();
      const result = await postApi<{ email: string; vorschauLink?: string }>(
        '/essensplanung/anlegen',
        { email, name, planungName, ersterTag, letzterTag, altcha }
      );
      anlegenArt = 'success';
      anlegenMeldung = `Fast geschafft: Wir haben dir einen Link an ${result.email} geschickt. Mit dem Klick darauf entsteht deine Planung. Schau auch im Spam-Ordner nach.`;
      anlegenVorschau = result.vorschauLink ?? null;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) anlegenFehler = error.fields;
      anlegenArt = 'error';
      anlegenMeldung = errorMessage(
        error,
        'Die Planung konnte nicht angefragt werden. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
    } finally {
      anlegenAltcha?.reset();
      anlegenBusy = false;
    }
  }

  // „Meine Planungen“
  let meineEmail = $state('');
  let meineFehler = $state<Record<string, string>>({});
  let meineBusy = $state(false);
  let meineMeldung = $state<string | null>(null);
  let meineArt = $state<'success' | 'error'>('success');
  let meineVorschau = $state<{ planungName: string; link: string }[]>([]);
  let meineAltcha = $state<AltchaWidget | null>(null);

  async function meine(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (meineBusy) return;
    meineBusy = true;
    meineFehler = {};
    meineMeldung = null;
    meineVorschau = [];
    try {
      const altcha = await meineAltcha?.solve();
      const result = await postApi<{
        email: string;
        vorschauLinks?: { planungName: string; link: string }[];
      }>('/essensplanung/meine', { email: meineEmail, altcha });
      meineArt = 'success';
      meineMeldung = `Wenn ${result.email} in einer Planung Mitglied ist, kommt gleich eine Mail mit neuen Links. Die bisherigen Links gelten dann nicht mehr.`;
      meineVorschau = result.vorschauLinks ?? [];
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) meineFehler = error.fields;
      meineArt = 'error';
      meineMeldung = errorMessage(
        error,
        'Die Anfrage hat nicht geklappt. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
    } finally {
      meineAltcha?.reset();
      meineBusy = false;
    }
  }

  function entfernen(token: string): void {
    vergiss(token);
    zuletzt = zuletztGeoeffnet();
  }
</script>

<div class="space-y-10">
  <section aria-labelledby="ep-intro" class="space-y-3">
    <h2 id="ep-intro" class="font-serif text-2xl font-bold text-brand-900">
      Essen für Aktionen planen
    </h2>
    <p class="max-w-prose text-neutral-800">
      Mit der Essensplanung plant ein Küchenteam gemeinsam Mahlzeiten, Gerichte und Einkäufe für ein
      Lager oder eine andere Aktion. Ihr braucht kein Konto: Wer mitplant, bekommt einen
      persönlichen Link. Der DPSG Stamm Phoenix stellt das Werkzeug bereit.
    </p>
  </section>

  {#if zuletzt.length}
    <section aria-labelledby="ep-zuletzt" class="space-y-3">
      <h2 id="ep-zuletzt" class="font-serif text-xl font-bold text-brand-900">
        Auf diesem Gerät geöffnet
      </h2>
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each zuletzt as eintrag (eintrag.token)}
          <li class="flex flex-wrap items-center justify-between gap-3 py-3">
            <a
              class="font-semibold text-link underline"
              href={planungUrl(eintrag.token)}
              data-astro-reload>{eintrag.name}</a
            >
            <span class="flex items-center gap-3 text-sm text-neutral-700">
              {eintrag.zugang === 'lesen' ? 'nur ansehen' : ''}
              <ActionButton type="button" onclick={() => entfernen(eintrag.token)}
                >Von diesem Gerät entfernen</ActionButton
              >
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="grid gap-10 lg:grid-cols-2">
    <section aria-labelledby="ep-anlegen" class="surface space-y-4 p-5 md:p-6">
      <div class="flex items-center gap-1">
        <h2 id="ep-anlegen" class="font-serif text-xl font-bold text-brand-900">
          Neue Planung anlegen
        </h2>
        <InfoHint
          label="Neue Planung anlegen"
          text="Du bekommst einen Link per Mail; erst mit dem Klick darauf entsteht die Planung. Danach lädst du die anderen aus deinem Küchenteam ein."
        />
      </div>
      <form novalidate class="space-y-4" onsubmit={anlegen}>
        <fieldset disabled={anlegenBusy} class="min-w-0 space-y-4">
          <legend class="sr-only">Neue Planung</legend>
          <FormField
            id="ep-planung-name"
            label="Name der Planung"
            error={anlegenFehler.planungName}
          >
            {#snippet children(attrs)}
              <input
                {...attrs}
                class="form-input"
                maxlength="150"
                placeholder="z. B. Sommerlager 2027"
                bind:value={planungName}
              />
            {/snippet}
          </FormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField id="ep-erster-tag" label="Erster Tag" error={anlegenFehler.ersterTag}>
              {#snippet children(attrs)}
                <input {...attrs} type="date" class="form-input" bind:value={ersterTag} />
              {/snippet}
            </FormField>
            <FormField id="ep-letzter-tag" label="Letzter Tag" error={anlegenFehler.letzterTag}>
              {#snippet children(attrs)}
                <input {...attrs} type="date" class="form-input" bind:value={letzterTag} />
              {/snippet}
            </FormField>
          </div>
          <FormField id="ep-name" label="Dein Name" error={anlegenFehler.name}>
            {#snippet children(attrs)}
              <input
                {...attrs}
                class="form-input"
                maxlength="100"
                autocomplete="name"
                bind:value={name}
              />
            {/snippet}
          </FormField>
          <FormField id="ep-email" label="Deine Mailadresse" error={anlegenFehler.email}>
            {#snippet children(attrs)}
              <input
                {...attrs}
                type="email"
                class="form-input"
                autocomplete="email"
                bind:value={email}
              />
            {/snippet}
          </FormField>
          <AltchaWidget bind:this={anlegenAltcha} />
          <ActionButton variant="primary" type="submit" aria-busy={anlegenBusy}>
            {anlegenBusy ? 'Wird gesendet …' : 'Link zum Anlegen schicken'}
          </ActionButton>
        </fieldset>
      </form>
      <StatusNotice message={anlegenMeldung} kind={anlegenArt} />
      {#if anlegenVorschau}
        <p class="text-sm">
          Vorschau-Umgebung, es wird keine Mail verschickt:
          <a class="font-semibold text-link underline" href={anlegenVorschau} data-astro-reload
            >Planung bestätigen</a
          >
        </p>
      {/if}
    </section>

    <section aria-labelledby="ep-meine" class="surface space-y-4 p-5 md:p-6">
      <div class="flex items-center gap-1">
        <h2 id="ep-meine" class="font-serif text-xl font-bold text-brand-900">Meine Planungen</h2>
        <InfoHint
          label="Meine Planungen"
          text="Link verloren? Gib die Adresse ein, mit der du eingeladen wurdest oder die Planung angelegt hast. Du bekommst eine Mail mit neuen Links zu allen deinen Planungen."
        />
      </div>
      <form novalidate class="space-y-4" onsubmit={meine}>
        <fieldset disabled={meineBusy} class="min-w-0 space-y-4">
          <legend class="sr-only">Meine Planungen</legend>
          <FormField id="ep-meine-email" label="Deine Mailadresse" error={meineFehler.email}>
            {#snippet children(attrs)}
              <input
                {...attrs}
                type="email"
                class="form-input"
                autocomplete="email"
                bind:value={meineEmail}
              />
            {/snippet}
          </FormField>
          <AltchaWidget bind:this={meineAltcha} />
          <ActionButton variant="primary" type="submit" aria-busy={meineBusy}>
            {meineBusy ? 'Wird gesendet …' : 'Links schicken'}
          </ActionButton>
        </fieldset>
      </form>
      <StatusNotice message={meineMeldung} kind={meineArt} />
      {#if meineVorschau.length}
        <div class="text-sm">
          <p>Vorschau-Umgebung, es wird keine Mail verschickt:</p>
          <ul class="mt-1 list-disc pl-5">
            {#each meineVorschau as eintrag (eintrag.link)}
              <li>
                <a class="text-link underline" href={eintrag.link} data-astro-reload
                  >{eintrag.planungName}</a
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  </div>
</div>
