<script lang="ts">
  import { onMount } from 'svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { ApiError, errorMessage } from '../../lib/api';
  import { merkeGeoeffnet, planungApi, tokenAusHash, datumLang } from '../../lib/essensplanung';
  import type { PlanungAnsicht } from '../../lib/types';
  import PlanTage from './PlanTage.svelte';
  import PlanMitglieder from './PlanMitglieder.svelte';
  import PlanEinstellungen from './PlanEinstellungen.svelte';
  import PlanAenderungen from './PlanAenderungen.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The page of a Planung. The token comes from the link (`#t=…`); the page asks every 2.5
   * seconds whether something changed and then shows the new state, so several people can plan
   * at the same time without reloading.
   */

  const POLL_MS = 2500;
  const POLL_MAX_MS = 30_000;

  let token = $state<string | null>(null);
  let ansicht = $state<PlanungAnsicht | null>(null);
  let ladeFehler = $state<string | null>(null);
  let ungueltig = $state(false);
  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let meldungArt = $state<'success' | 'error'>('success');
  let bereich = $state<'plan' | 'mitglieder' | 'einstellungen'>('plan');
  let offline = $state(false);

  const bereiche = $derived([
    { id: 'plan', label: 'Plan' },
    ...(ansicht && ansicht.zugang !== 'lesen' ? [{ id: 'mitglieder', label: 'Mitglieder' }] : []),
    ...(ansicht && ansicht.zugang !== 'lesen'
      ? [{ id: 'einstellungen', label: 'Einstellungen' }]
      : []),
  ] as { id: typeof bereich; label: string }[]);

  function zeige(neu: PlanungAnsicht): void {
    ansicht = neu;
    if (token) merkeGeoeffnet(token, neu.name, neu.zugang);
  }

  function hinweis(text: string | null, art: 'success' | 'error' = 'success'): void {
    meldung = text;
    meldungArt = art;
  }

  async function laden(): Promise<void> {
    if (!token) return;
    try {
      zeige(await planungApi(token).laden());
      ladeFehler = null;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'LINK_UNGUELTIG') ungueltig = true;
      ladeFehler = errorMessage(
        error,
        'Die Planung konnte nicht geladen werden. Lade die Seite neu.'
      );
    }
  }

  /** The changes waiting for the one before, so a field left during a save is saved too. */
  let kette: Promise<unknown> = Promise.resolve();

  /**
   * Runs a change after the ones before. On success the answer is the new view; a conflict or a
   * deleted entry loads the current state and keeps the message.
   */
  function aendern(
    work: () => Promise<PlanungAnsicht | { ansicht: PlanungAnsicht } | undefined>,
    erfolg?: string
  ): Promise<boolean> {
    const lauf = kette.then(() => ausfuehren(work, erfolg));
    kette = lauf;
    return lauf;
  }

  async function ausfuehren(
    work: () => Promise<PlanungAnsicht | { ansicht: PlanungAnsicht } | undefined>,
    erfolg?: string
  ): Promise<boolean> {
    if (!token) return false;
    busy = true;
    hinweis(null);
    try {
      const result = await work();
      if (result && 'ansicht' in result) zeige(result.ansicht);
      else if (result) zeige(result);
      if (erfolg) hinweis(erfolg);
      return true;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'LINK_UNGUELTIG') ungueltig = true;
      if (error instanceof ApiError && [404, 409].includes(error.status)) await laden();
      hinweis(
        errorMessage(
          error,
          'Das hat nicht geklappt. Prüfe deine Internetverbindung und versuche es noch einmal.'
        ),
        'error'
      );
      return false;
    } finally {
      busy = false;
    }
  }

  const kontext: PlanKontext = {
    get ansicht() {
      return ansicht!;
    },
    get busy() {
      return busy;
    },
    get api() {
      return planungApi(token ?? '');
    },
    get token() {
      return token ?? '';
    },
    aendern,
    hinweis,
    zeige,
  };

  onMount(() => {
    // Another link opened in this tab (same page, other fragment) gets a fresh start
    const onHash = (): void => window.location.reload();
    window.addEventListener('hashchange', onHash);
    token = tokenAusHash(window.location.hash, 't');
    if (!token) {
      ungueltig = true;
      ladeFehler = 'Der Link ist unvollständig. Öffne ihn bitte noch einmal aus der Mail.';
      return () => window.removeEventListener('hashchange', onHash);
    }
    void laden();

    let wait = POLL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async (): Promise<void> => {
      timer = undefined;
      if (document.visibilityState === 'visible' && ansicht && token && !busy && !ungueltig) {
        controller = new AbortController();
        try {
          const stand = await planungApi(token).stand(ansicht.stand, controller.signal);
          if (stand.ansicht && !busy) zeige(stand.ansicht);
          wait = POLL_MS;
          offline = false;
        } catch (error: unknown) {
          if (error instanceof ApiError && error.code === 'LINK_UNGUELTIG') ungueltig = true;
          wait = Math.min(wait * 2, POLL_MAX_MS);
          offline = !(error instanceof ApiError);
        }
      }
      if (!ungueltig) timer = setTimeout(() => void poll(), wait);
    };
    timer = setTimeout(() => void poll(), POLL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && timer) {
        clearTimeout(timer);
        wait = POLL_MS;
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hashchange', onHash);
    };
  });
</script>

{#if ungueltig || (ladeFehler && !ansicht)}
  <div class="max-w-xl space-y-4">
    <StatusNotice message={ladeFehler ?? 'Dieser Link gilt nicht mehr.'} kind="error" />
    <p>
      <a class="font-semibold text-link underline" href="/essensplanung">Zur Essensplanung</a> – unter
      „Meine Planungen“ bekommst du neue Links zu deinen Planungen.
    </p>
  </div>
{:else if !ansicht}
  <p role="status" class="text-neutral-700">Die Planung wird geladen …</p>
{:else}
  <div class="space-y-6">
    <div class="space-y-1">
      <h2 class="font-serif text-2xl font-bold text-brand-900 [overflow-wrap:anywhere]">
        {ansicht.name}
      </h2>
      <p class="text-sm text-neutral-700">
        {#if ansicht.tage.length}
          {datumLang(ansicht.tage[0].datum)} bis {datumLang(ansicht.tage.at(-1)!.datum)} ·
        {/if}
        {ansicht.zugang === 'lesen'
          ? 'Nur ansehen'
          : ansicht.zugang === 'besitzer'
            ? 'Du bist Besitzer:in'
            : 'Du planst mit'}
      </p>
    </div>

    {#if ansicht.wartung}
      <p class="border-l-4 border-warning py-2 pl-3 text-sm text-warning" role="status">
        Die Essensplanung wird gerade gewartet. Du kannst alles ansehen, aber nichts ändern.
      </p>
    {/if}
    {#if offline}
      <p class="text-sm text-neutral-700 print:hidden" role="status">
        Keine Verbindung. Die Seite versucht es weiter; Änderungen anderer siehst du, sobald die
        Verbindung zurück ist.
      </p>
    {/if}

    <div class="print:hidden">
      <StatusNotice message={meldung} kind={meldungArt} popup />
    </div>

    {#if bereiche.length > 1}
      <div
        role="tablist"
        aria-label="Bereiche der Planung"
        class="flex flex-wrap gap-2 print:hidden"
      >
        {#each bereiche as eintrag (eintrag.id)}
          <button
            type="button"
            role="tab"
            aria-selected={bereich === eintrag.id}
            class={bereich === eintrag.id ? 'btn-primary' : 'btn-secondary'}
            onclick={() => (bereich = eintrag.id)}>{eintrag.label}</button
          >
        {/each}
      </div>
    {/if}

    <!-- All areas stay mounted, so switching keeps what is typed in another one -->
    <div role="tabpanel" hidden={bereich !== 'plan'}>
      <PlanTage {kontext} />
    </div>
    {#if ansicht.zugang !== 'lesen'}
      <div role="tabpanel" hidden={bereich !== 'mitglieder'}>
        <PlanMitglieder {kontext} />
      </div>
      <div role="tabpanel" hidden={bereich !== 'einstellungen'}>
        <PlanEinstellungen {kontext} />
      </div>
    {/if}

    <PlanAenderungen aenderungen={ansicht.aenderungen} />
  </div>
{/if}
