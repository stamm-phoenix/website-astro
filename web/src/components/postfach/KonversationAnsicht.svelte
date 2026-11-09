<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import LoadState from '../ui/LoadState.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import MailInhalt from './MailInhalt.svelte';
  import ZustaendigWahl from './ZustaendigWahl.svelte';
  import StatusWahl from './StatusWahl.svelte';
  import { errorMessage } from '../../lib/api';
  import { anhangUrl, ladeKonversation } from '../../lib/postfachStore.svelte';
  import { dateiGroesse, mailZeitLang } from '../../lib/postfachAnsicht';
  import {
    standFuer,
    type KonversationDetail,
    type KonversationZeile,
    type MailAdresse,
    type MailNachricht,
  } from '../../../../api/lib/postfach-model';

  /**
   * The reading view of a conversation: who is responsible, where it stands, the messages oldest
   * first (all but the newest folded), and the way to Outlook. Opening it changes nothing.
   */
  interface Props {
    postfach: string;
    outlookPostfach: string;
    konversation: string;
    ich: string;
    onzurueck: () => void;
    onkonflikt: () => void;
    /** Counts „Neu laden“ of the page; each change reads the open conversation again. */
    neuladen?: number;
  }
  let {
    postfach,
    outlookPostfach,
    konversation,
    ich,
    onzurueck,
    onkonflikt,
    neuladen = 0,
  }: Props = $props();

  let detail = $state<KonversationDetail | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let offen = $state<Set<string>>(new Set());
  let ladeFehler = $state<string | null>(null);
  let heading = $state<HTMLHeadingElement | null>(null);

  /** The request of the last load; an older answer, also for the same conversation, is dropped. */
  let anfrage = 0;
  let laufend: AbortController | null = null;
  onDestroy(() => laufend?.abort());

  /**
   * Takes over a saved change of the open conversation. A load asked before it would bring the
   * old state back, so it is dropped; a late answer for another conversation changes nothing here.
   */
  function uebernimm(id: string, change: Partial<KonversationZeile>): void {
    if (detail?.konversation.id !== id) return;
    anfrage++;
    laufend?.abort();
    loading = false;
    detail = { ...detail, konversation: { ...detail.konversation, ...change } };
  }

  async function laden(id: string): Promise<void> {
    // Another conversation: its predecessor must not stay on screen with working buttons
    if (detail?.konversation.id !== id) detail = null;
    loading = true;
    error = null;
    ladeFehler = null;
    const nummer = ++anfrage;
    laufend?.abort();
    const controller = (laufend = new AbortController());
    const aktuell = (): boolean => nummer === anfrage && id === konversation;
    try {
      const data = await ladeKonversation(postfach, id, controller.signal);
      if (!aktuell()) return;
      detail = data;
      // The newest is unfolded
      const neueste = data.nachrichten.at(-1);
      offen = new Set(neueste ? [neueste.id] : []);
      // The heading appears with the data; focus it once it is on screen
      await tick();
      if (!aktuell()) return;
      heading?.focus();
    } catch (loadError: unknown) {
      if (!aktuell()) return;
      if (detail?.konversation.id === id) {
        // „Neu laden“ of the open conversation: what is shown stays, the failure is named
        ladeFehler = errorMessage(
          loadError,
          'Die E-Mail konnte nicht neu geladen werden. Du siehst den letzten Stand.'
        );
        return;
      }
      detail = null;
      error = errorMessage(
        loadError,
        'Die E-Mail konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.'
      );
    } finally {
      if (nummer === anfrage) loading = false;
    }
  }

  $effect(() => {
    const id = konversation;
    void neuladen;
    untrack(() => void laden(id));
  });

  function umschalten(id: string): void {
    // A new set, so the change is seen; `offen` is replaced as a whole on every load
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(offen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    offen = next;
  }

  function adressen(liste: MailAdresse[]): string {
    return liste.map((adresse) => adresse.name || adresse.adresse).join(', ');
  }

  function absender(nachricht: MailNachricht): string {
    if (nachricht.gesendet) return `${nachricht.von.name} (aus dem Postfach gesendet)`;
    return nachricht.von.adresse && nachricht.von.adresse !== nachricht.von.name
      ? `${nachricht.von.name} <${nachricht.von.adresse}>`
      : nachricht.von.name;
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-2 lg:hidden">
    <button
      type="button"
      class="text-link inline-flex min-h-11 items-center gap-1 font-semibold"
      onclick={onzurueck}
    >
      <span aria-hidden="true">←</span> Zur Liste
    </button>
  </div>

  <LoadState
    data={detail}
    {loading}
    {error}
    loadingText="E-Mail wird geladen …"
    onretry={() => void laden(konversation)}
  >
    {#snippet children(data)}
      <article aria-labelledby="konversation-betreff" class="space-y-3">
        <header class="space-y-2">
          <h2
            id="konversation-betreff"
            bind:this={heading}
            tabindex="-1"
            class="font-serif text-xl font-semibold break-words text-brand-900 focus:outline-none"
          >
            {data.konversation.betreff}
          </h2>
          <div class="flex flex-wrap gap-2">
            <a
              class="btn-primary inline-flex items-center gap-1"
              href={data.outlookUrl ?? outlookPostfach}
              target="_blank"
              rel="noopener noreferrer"
              >In Outlook öffnen<span aria-hidden="true">↗</span><span class="sr-only">
                (öffnet neuen Tab)</span
              ></a
            >
          </div>
          {#if ladeFehler}<p role="alert" class="text-sm text-danger">
              <MessageText text={ladeFehler} />
            </p>{/if}
        </header>

        <!-- A fresh one per conversation, so a choice in progress never carries over -->
        {#key data.konversation.id}
          <ZustaendigWahl
            {postfach}
            konversation={data.konversation.id}
            zustaendig={data.konversation.zustaendig}
            {ich}
            onaenderung={(id, ergebnis) =>
              uebernimm(id, {
                zustaendig: ergebnis.zustaendig,
                status: ergebnis.status,
              })}
            onkonflikt={(id) => {
              onkonflikt();
              if (id === konversation) void laden(id);
            }}
          />
          <section aria-label="Stand" class="surface-muted p-3">
            <StatusWahl
              {postfach}
              konversation={data.konversation.id}
              status={data.konversation.status}
              bis={data.konversation.am}
              onaenderung={(id, stand, bis) =>
                uebernimm(id, standFuer(stand, detail?.konversation.am ?? bis, bis))}
              onkonflikt={(id) => {
                onkonflikt();
                if (id === konversation) void laden(id);
              }}
            />
          </section>
        {/key}

        {#if !data.vollstaendig}
          <p class="text-sm text-warning">
            Diese Unterhaltung ist sehr lang. Alle Nachrichten siehst du in Outlook.
          </p>
        {/if}

        <ol class="space-y-3" aria-label="Nachrichten, älteste zuerst">
          {#each data.nachrichten as nachricht (nachricht.id)}
            {@const aufgeklappt = offen.has(nachricht.id)}
            <li class="surface overflow-hidden">
              <button
                type="button"
                class="flex w-full min-w-0 flex-wrap items-baseline justify-between gap-x-3 p-3 text-left"
                aria-expanded={aufgeklappt}
                onclick={() => umschalten(nachricht.id)}
              >
                <span class="min-w-0 font-semibold break-words text-brand-900"
                  >{absender(nachricht)}</span
                >
                <span class="text-sm text-neutral-700">{mailZeitLang(nachricht.am)}</span>
                {#if !aufgeklappt}
                  <span class="block w-full truncate text-sm text-neutral-700"
                    >{nachricht.vorschau || 'Antippen zum Lesen'}</span
                  >
                {/if}
              </button>
              {#if aufgeklappt}
                <div class="space-y-3 border-t border-neutral-200 p-3">
                  <dl class="grid grid-cols-[auto_1fr] gap-x-3 text-sm text-neutral-700">
                    {#if nachricht.an.length}<dt>An</dt>
                      <dd class="break-words">{adressen(nachricht.an)}</dd>{/if}
                    {#if nachricht.cc.length}<dt>Kopie</dt>
                      <dd class="break-words">{adressen(nachricht.cc)}</dd>{/if}
                  </dl>
                  <MailInhalt
                    html={nachricht.html}
                    text={nachricht.text}
                    betreff={nachricht.betreff}
                  />
                  {#if nachricht.anhaenge.length}
                    <ul class="flex flex-wrap gap-2" aria-label="Anhänge">
                      {#each nachricht.anhaenge as anhang (anhang.id)}
                        <li class="max-w-full min-w-0">
                          {#if anhang.herunterladbar}
                            <a
                              class="surface-muted inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2 px-3 py-1.5 text-sm"
                              href={anhangUrl(postfach, nachricht.id, anhang.id)}
                              download={anhang.name}
                            >
                              <!-- Long file names without spaces break instead of being cut off -->
                              <span class="min-w-0 font-semibold break-all text-brand-900"
                                >{anhang.name}</span
                              >
                              <span class="text-neutral-700">{dateiGroesse(anhang.groesse)}</span>
                            </a>
                          {:else}
                            <!-- Attached messages and large files only open in Outlook -->
                            <a
                              class="surface-muted inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2 px-3 py-1.5 text-sm"
                              href={data.outlookUrl ?? outlookPostfach}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <!-- Long file names without spaces break instead of being cut off -->
                              <span class="min-w-0 font-semibold break-all text-brand-900"
                                >{anhang.name}</span
                              >
                              <span class="text-neutral-700"
                                >in Outlook öffnen<span aria-hidden="true">↗</span></span
                              >
                            </a>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ol>
      </article>
    {/snippet}
  </LoadState>
</div>
