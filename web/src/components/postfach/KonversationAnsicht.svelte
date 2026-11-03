<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import MailInhalt from './MailInhalt.svelte';
  import ZustaendigWahl from './ZustaendigWahl.svelte';
  import { errorMessage } from '../../lib/api';
  import {
    aendereZeile,
    anhangUrl,
    ladeKonversation,
    markiere,
  } from '../../lib/postfachStore.svelte';
  import { dateiGroesse, mailZeitLang } from '../../lib/postfachAnsicht';
  import type {
    KonversationDetail,
    MailAdresse,
    MailNachricht,
  } from '../../../../api/lib/postfach-model';

  /**
   * The reading view of a conversation: who is responsible, the messages oldest first (read
   * ones folded), and the way to Outlook. Opening it marks the unread messages as read for the
   * person; „Als ungelesen markieren“ undoes that for the newest one.
   */
  interface Props {
    postfach: string;
    outlookPostfach: string;
    konversation: string;
    ich: string;
    onzurueck: () => void;
    onkonflikt: () => void;
  }
  let { postfach, outlookPostfach, konversation, ich, onzurueck, onkonflikt }: Props = $props();

  let detail = $state<KonversationDetail | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let offen = $state<Set<string>>(new Set());
  let markFehler = $state<string | null>(null);
  let markMeldung = $state<string | null>(null);
  let heading = $state<HTMLHeadingElement | null>(null);

  async function laden(id: string): Promise<void> {
    // Another conversation: its predecessor must not stay on screen with working buttons
    if (detail?.konversation.id !== id) detail = null;
    loading = true;
    error = null;
    markMeldung = null;
    markFehler = null;
    const controller = new AbortController();
    try {
      const data = await ladeKonversation(postfach, id, controller.signal);
      if (id !== konversation) return;
      detail = data;
      const ungelesen = data.nachrichten.filter((nachricht) => !nachricht.gelesen);
      // Unread ones and the newest are unfolded
      offen = new Set([
        ...ungelesen.map((nachricht) => nachricht.id),
        ...(data.nachrichten.at(-1) ? [data.nachrichten.at(-1)!.id] : []),
      ]);
      heading?.focus();
      if (ungelesen.length) {
        try {
          await markiere(
            postfach,
            ungelesen.map((nachricht) => nachricht.id),
            true
          );
          // With only part of a long conversation read, the rest may still be unread
          if (data.vollstaendig) aendereZeile(id, { ungelesen: 0 });
        } catch (markError: unknown) {
          markFehler = errorMessage(
            markError,
            'Die E-Mail konnte nicht als gelesen gespeichert werden; sie bleibt in der Liste ungelesen.'
          );
        }
      }
    } catch (loadError: unknown) {
      if (id !== konversation) return;
      detail = null;
      error = errorMessage(
        loadError,
        'Die E-Mail konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.'
      );
    } finally {
      if (id === konversation) loading = false;
    }
  }

  $effect(() => {
    const id = konversation;
    untrack(() => void laden(id));
  });

  async function alsUngelesen(): Promise<void> {
    const id = detail?.konversation.id;
    const neueste = detail?.nachrichten.filter((nachricht) => !nachricht.gesendet).at(-1);
    if (!id || !neueste) return;
    markFehler = null;
    try {
      await markiere(postfach, [neueste.id], false);
      aendereZeile(id, { ungelesen: 1 });
      if (id === konversation) markMeldung = 'Als ungelesen markiert.';
    } catch (markError: unknown) {
      if (id !== konversation) return;
      markFehler = errorMessage(
        markError,
        'Die E-Mail konnte nicht als ungelesen markiert werden. Versuche es noch einmal.'
      );
    }
  }

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
            <ActionButton onclick={alsUngelesen}>Als ungelesen markieren</ActionButton>
          </div>
          {#if markMeldung}<p role="status" class="text-sm text-success">{markMeldung}</p>{/if}
          {#if markFehler}<p role="alert" class="text-sm text-danger">
              <MessageText text={markFehler} />
            </p>{/if}
        </header>

        <!-- A fresh one per conversation, so a choice in progress never carries over -->
        {#key data.konversation.id}
          <ZustaendigWahl
            {postfach}
            konversation={data.konversation.id}
            zustaendig={data.konversation.zustaendig}
            {ich}
            onaenderung={(id, zustaendig) => {
              // A late answer for another conversation only changes its line in the list
              if (detail?.konversation.id === id)
                detail = { ...detail, konversation: { ...detail.konversation, zustaendig } };
            }}
            onkonflikt={(id) => {
              onkonflikt();
              if (id === konversation) void laden(id);
            }}
          />
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
                        <li>
                          {#if anhang.herunterladbar}
                            <a
                              class="surface-muted inline-flex min-h-11 items-center gap-2 px-3 text-sm"
                              href={anhangUrl(postfach, nachricht.id, anhang.id)}
                              download={anhang.name}
                            >
                              <span class="font-semibold text-brand-900">{anhang.name}</span>
                              <span class="text-neutral-700">{dateiGroesse(anhang.groesse)}</span>
                            </a>
                          {:else}
                            <!-- Attached messages and large files only open in Outlook -->
                            <a
                              class="surface-muted inline-flex min-h-11 items-center gap-2 px-3 text-sm"
                              href={data.outlookUrl ?? outlookPostfach}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span class="font-semibold text-brand-900">{anhang.name}</span>
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
