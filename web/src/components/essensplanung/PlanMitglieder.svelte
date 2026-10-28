<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import CopyCode from '../ui/CopyCode.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { beitrittUrl, planungUrl } from '../../lib/essensplanung';
  import type { PlanungAnsicht, PlanungMitglied } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /** Members, invitations and the shared links of a Planung. */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const besitzer = $derived(ansicht.zugang === 'besitzer');
  const aktiv = $derived(ansicht.mitglieder.filter((mitglied) => !mitglied.entzogen));
  const gesperrt = $derived(ansicht.wartung);

  let name = $state('');
  let email = $state('');
  let rolle = $state<'bearbeiten' | 'besitzer'>('bearbeiten');
  let felder = $state<Record<string, string>>({});
  let vorschau = $state<string | null>(null);

  interface Antwort {
    ansicht: PlanungAnsicht;
    gesendet: boolean;
    vorschauLink?: string;
  }

  /** The message after a mail: sent, shown (preview) or failed. */
  function mailHinweis(antwort: Antwort, wer: string): void {
    vorschau = antwort.vorschauLink ?? null;
    if (antwort.gesendet) kontext.hinweis(`Mail an ${wer} ist unterwegs.`);
    else if (antwort.vorschauLink)
      kontext.hinweis('Vorschau-Umgebung: keine Mail, der Link steht unten.');
    else
      kontext.hinweis(
        `Die Mail an ${wer} konnte nicht verschickt werden. Versuche es später mit „Neuen Link schicken“.`,
        'error'
      );
  }

  async function einladen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    felder = {};
    let antwort: Antwort | undefined;
    const ok = await kontext.aendern(async () => {
      try {
        antwort = await kontext.api.senden<Antwort>('POST', '/mitglieder', { name, email, rolle });
        return antwort;
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields) felder = error.fields;
        throw error;
      }
    });
    if (ok && antwort) {
      mailHinweis(antwort, email.trim());
      name = '';
      email = '';
      rolle = 'bearbeiten';
    }
  }

  async function neuerLink(mitglied: PlanungMitglied): Promise<void> {
    let antwort: Antwort | undefined;
    const ok = await kontext.aendern(async () => {
      antwort = await kontext.api.senden<Antwort>('POST', `/mitglieder/${mitglied.id}/link`);
      return antwort;
    });
    if (ok && antwort) mailHinweis(antwort, mitglied.name);
  }

  async function rolleAendern(
    mitglied: PlanungMitglied,
    neu: 'besitzer' | 'bearbeiten'
  ): Promise<void> {
    await kontext.aendern(
      () =>
        kontext.api.senden('PATCH', `/mitglieder/${mitglied.id}`, {
          etag: mitglied.etag,
          rolle: neu,
        }),
      `${mitglied.name} ist jetzt ${neu === 'besitzer' ? 'Besitzer:in' : 'Bearbeitende:r'}.`
    );
  }

  async function entziehen(mitglied: PlanungMitglied): Promise<void> {
    if (
      !(await confirmAction({
        title: `${mitglied.name} den Zugang entziehen?`,
        message: `Der Link von ${mitglied.name} funktioniert sofort nicht mehr. Der Name bleibt bei bisherigen Änderungen stehen.`,
        confirmLabel: 'Zugang entziehen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/mitglieder/${mitglied.id}`, undefined, mitglied.etag),
      `${mitglied.name} hat keinen Zugang mehr.`
    );
  }

  async function link(art: 'beitritt' | 'lesen', an: boolean): Promise<void> {
    if (
      !an &&
      !(await confirmAction({
        title:
          art === 'beitritt' ? 'Link zum Beitreten abschalten?' : 'Link zum Ansehen abschalten?',
        message:
          'Der Link funktioniert danach nicht mehr. Wer schon beigetreten ist, behält seinen Zugang.',
        confirmLabel: 'Abschalten',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('POST', '/links', { art, an }),
      an ? 'Neuer Link erzeugt. Der vorige funktioniert nicht mehr.' : 'Link abgeschaltet.'
    );
  }

  /** The saved name and the input; changes of others replace the input only without a draft. */
  const gespeicherterName = $derived(
    ansicht.mitglieder.find((mitglied) => mitglied.ich)?.name ?? ''
  );
  let basisName = $state('');
  let eigenerName = $state('');
  const namensEntwurf = $derived(eigenerName !== basisName);
  $effect(() => {
    const neu = gespeicherterName;
    untrack(() => {
      if (namensEntwurf) return;
      basisName = neu;
      eigenerName = neu;
    });
  });
  $effect(() => guardUnsavedChanges(() => namensEntwurf));

  async function namenSpeichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const gesendet = eigenerName;
    const ok = await kontext.aendern(
      () => kontext.api.senden('PATCH', '/ich', { name: gesendet }),
      'Dein Name ist gespeichert.'
    );
    if (ok) {
      basisName = gespeicherterName;
      // A name typed again while saving stays as a draft
      if (eigenerName === gesendet) eigenerName = gespeicherterName;
    }
  }
</script>

<div class="space-y-8">
  <section aria-labelledby="mitglieder-heading" class="space-y-3">
    <h3 id="mitglieder-heading" class="font-serif text-xl font-bold text-brand-900">Mitglieder</h3>
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each aktiv as mitglied (mitglied.id)}
        <li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
              {mitglied.name}{mitglied.ich ? ' (du)' : ''}
            </p>
            <p class="text-sm text-neutral-700">
              {mitglied.rolle === 'besitzer' ? 'Besitzer:in' : 'Bearbeiten'}{mitglied.email
                ? ` · ${mitglied.email}`
                : ''}
            </p>
          </div>
          {#if ansicht.darfVerwalten && !mitglied.ich && !gesperrt}
            <div class="flex flex-wrap gap-2 print:hidden">
              {#if besitzer}
                <ActionButton
                  type="button"
                  disabled={kontext.busy}
                  onclick={() =>
                    void rolleAendern(
                      mitglied,
                      mitglied.rolle === 'besitzer' ? 'bearbeiten' : 'besitzer'
                    )}
                  >{mitglied.rolle === 'besitzer'
                    ? 'Zu Bearbeiten'
                    : 'Zur Besitzer:in'}</ActionButton
                >
              {/if}
              {#if mitglied.email && (besitzer || mitglied.rolle !== 'besitzer')}
                <ActionButton
                  type="button"
                  disabled={kontext.busy}
                  onclick={() => void neuerLink(mitglied)}>Neuen Link schicken</ActionButton
                >
              {/if}
              {#if besitzer || mitglied.rolle !== 'besitzer'}
                <ActionButton
                  type="button"
                  variant="danger"
                  disabled={kontext.busy}
                  onclick={() => void entziehen(mitglied)}>Zugang entziehen</ActionButton
                >
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if vorschau}
      <p class="text-sm print:hidden">
        Vorschau-Umgebung, Link statt Mail: <a class="break-all text-link underline" href={vorschau}
          >{vorschau}</a
        >
      </p>
    {/if}
  </section>

  {#if ansicht.ichId !== null}
    <section aria-labelledby="ich-heading" class="space-y-3 print:hidden">
      <h3 id="ich-heading" class="font-serif text-xl font-bold text-brand-900">Du</h3>
      <form class="flex flex-wrap items-end gap-2" onsubmit={namenSpeichern}>
        <div class="min-w-0 flex-1">
          <label class="form-label" for="eigener-name">Dein Name in dieser Planung</label>
          <input id="eigener-name" class="form-input" maxlength="100" bind:value={eigenerName} />
        </div>
        <ActionButton type="submit" disabled={kontext.busy || gesperrt}>Speichern</ActionButton>
      </form>
      <div>
        <p class="form-label inline">Dein persönlicher Link</p>
        <InfoHint
          label="Dein persönlicher Link"
          class="ml-1"
          text="Speichere ihn als Lesezeichen. Gib ihn nicht weiter; andere lädst du unten ein."
        />
        <CopyCode wrap code={planungUrl(kontext.token)} label="Persönlicher Link" />
      </div>
    </section>
  {/if}

  {#if ansicht.darfVerwalten && !gesperrt}
    <section aria-labelledby="einladen-heading" class="surface space-y-4 p-5 print:hidden">
      <h3 id="einladen-heading" class="font-serif text-xl font-bold text-brand-900">
        Per Mail einladen
      </h3>
      <form novalidate class="space-y-4" onsubmit={einladen}>
        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="einladen-name" label="Name" error={felder.name}>
            {#snippet children(attrs)}
              <input {...attrs} class="form-input" maxlength="100" bind:value={name} />
            {/snippet}
          </FormField>
          <FormField id="einladen-email" label="Mailadresse" error={felder.email}>
            {#snippet children(attrs)}
              <input {...attrs} type="email" class="form-input" bind:value={email} />
            {/snippet}
          </FormField>
        </div>
        {#if besitzer}
          <label class="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <input
              type="checkbox"
              checked={rolle === 'besitzer'}
              onchange={(event) =>
                (rolle = event.currentTarget.checked ? 'besitzer' : 'bearbeiten')}
            />
            Als Besitzer:in einladen (darf alles, auch die Planung löschen)
          </label>
        {/if}
        <ActionButton variant="primary" type="submit" disabled={kontext.busy}>Einladen</ActionButton
        >
      </form>
    </section>

    <section aria-labelledby="links-heading" class="space-y-4 print:hidden">
      <h3 id="links-heading" class="font-serif text-xl font-bold text-brand-900">
        Gemeinsame Links
      </h3>
      <div class="space-y-2">
        <p class="flex items-center gap-1 font-semibold text-brand-900">
          Link zum Beitreten
          <InfoHint
            label="Link zum Beitreten"
            text="Wer ihn öffnet, gibt einen Namen ein und plant mit eigenem Link mit. Praktisch für eine Gruppe im Messenger."
          />
        </p>
        {#if ansicht.links?.beitritt}
          <CopyCode wrap code={beitrittUrl(ansicht.links.beitritt)} label="Link zum Beitreten" />
        {/if}
        <div class="flex flex-wrap gap-2">
          <ActionButton
            type="button"
            disabled={kontext.busy}
            onclick={() => void link('beitritt', true)}
          >
            {ansicht.links?.beitritt ? 'Neuen Link erzeugen' : 'Link erzeugen'}
          </ActionButton>
          {#if ansicht.links?.beitritt}
            <ActionButton
              type="button"
              variant="danger"
              disabled={kontext.busy}
              onclick={() => void link('beitritt', false)}>Abschalten</ActionButton
            >
          {/if}
        </div>
      </div>
      <div class="space-y-2">
        <p class="flex items-center gap-1 font-semibold text-brand-900">
          Link zum Ansehen
          <InfoHint
            label="Link zum Ansehen"
            text="Zeigt die ganze Planung, ohne etwas ändern zu können, z. B. für die Aktionsleitung."
          />
        </p>
        {#if ansicht.links?.lesen}
          <CopyCode wrap code={planungUrl(ansicht.links.lesen)} label="Link zum Ansehen" />
        {/if}
        <div class="flex flex-wrap gap-2">
          <ActionButton
            type="button"
            disabled={kontext.busy}
            onclick={() => void link('lesen', true)}
          >
            {ansicht.links?.lesen ? 'Neuen Link erzeugen' : 'Link erzeugen'}
          </ActionButton>
          {#if ansicht.links?.lesen}
            <ActionButton
              type="button"
              variant="danger"
              disabled={kontext.busy}
              onclick={() => void link('lesen', false)}>Abschalten</ActionButton
            >
          {/if}
        </div>
      </div>
    </section>
  {/if}
</div>
