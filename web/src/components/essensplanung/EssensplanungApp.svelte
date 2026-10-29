<script lang="ts">
  import { onMount, tick } from 'svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { ApiError, errorMessage } from '../../lib/api';
  import { merkeGeoeffnet, planungApi, tokenAusHash, datumLang } from '../../lib/essensplanung';
  import type { PlanungAnsicht } from '../../lib/types';
  import PlanTage from './PlanTage.svelte';
  import PlanGerichte from './PlanGerichte.svelte';
  import PlanTeilnehmende from './PlanTeilnehmende.svelte';
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
  /** Tab-local copy of the token, for a reload after another fragment like `#main`. */
  const LINK_KEY = 'essensplanung-link';
  const LINK_ERSETZT =
    'Dieser Link gilt nicht mehr, wahrscheinlich wurde ein neuer verschickt. Deine Eingaben stehen noch in den Feldern: kopiere sie dir und öffne die Planung mit dem neuen Link aus deiner Mail.';

  let token = $state<string | null>(null);
  let ansicht = $state<PlanungAnsicht | null>(null);
  let ladeFehler = $state<string | null>(null);
  let ungueltig = $state(false);
  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let meldungArt = $state<'success' | 'error'>('success');
  let bereich = $state<'plan' | 'gerichte' | 'teilnehmende' | 'mitglieder' | 'einstellungen'>(
    'plan'
  );
  let offline = $state(false);

  const bereiche = $derived([
    { id: 'plan', label: 'Plan' },
    { id: 'gerichte', label: 'Gerichte' },
    { id: 'teilnehmende', label: 'Teilnehmende' },
    ...(ansicht && ansicht.zugang !== 'lesen' ? [{ id: 'mitglieder', label: 'Mitglieder' }] : []),
    ...(ansicht && ansicht.zugang !== 'lesen'
      ? [{ id: 'einstellungen', label: 'Einstellungen' }]
      : []),
  ] as { id: typeof bereich; label: string }[]);

  /** Arrow keys, Home and End move between the areas (WAI-ARIA tabs pattern). */
  async function bereichTaste(event: KeyboardEvent): Promise<void> {
    const index = bereiche.findIndex((eintrag) => eintrag.id === bereich);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % bereiche.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + bereiche.length) % bereiche.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? bereiche.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    bereich = bereiche[next].id;
    await tick();
    document.getElementById(`bereich-${bereich}`)?.focus();
  }

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
    // The link was replaced meanwhile: nothing more is sent, the input stays on the page
    if (ungueltig) {
      hinweis(LINK_ERSETZT, 'error');
      return false;
    }
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
      if (!ungueltig && error instanceof ApiError && [404, 409].includes(error.status))
        await laden();
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
    get fehler() {
      return meldungArt === 'error' ? meldung : null;
    },
    aendern,
    hinweis,
    zeige,
  };

  onMount(() => {
    // Another link opened in this tab gets a fresh start; another fragment like „Zum Inhalt
    // springen“ (#main) keeps the Planung, also for a reload from the tab-local copy
    const onHash = (event: HashChangeEvent): void => {
      const neu = tokenAusHash(new URL(event.newURL).hash, 't');
      if (neu && neu !== token) window.location.reload();
    };
    window.addEventListener('hashchange', onHash);
    token = tokenAusHash(window.location.hash, 't');
    try {
      const ohneLink = !new URLSearchParams(window.location.hash.slice(1)).has('t');
      if (token) sessionStorage.setItem(LINK_KEY, token);
      else if (ohneLink) token = tokenAusHash(`#t=${sessionStorage.getItem(LINK_KEY) ?? ''}`, 't');
    } catch {
      // Without browser storage only the link in the address bar works
    }
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
          // No connection or a server error: either way the page shows no changes of others now
          offline = !(error instanceof ApiError && error.code === 'LINK_UNGUELTIG');
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

{#if !ansicht && (ungueltig || ladeFehler)}
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

    {#if ungueltig}
      <!-- A Planung already open keeps its fields, so nothing typed gets lost -->
      <StatusNotice message={LINK_ERSETZT} kind="error" />
    {/if}
    {#if ansicht.wartung}
      <p class="border-l-4 border-warning py-2 pl-3 text-sm text-warning" role="status">
        Die Essensplanung wird gerade gewartet. Du kannst alles ansehen, aber nichts ändern.
      </p>
    {/if}
    {#if offline}
      <p class="text-sm text-neutral-700 print:hidden" role="status">
        Der Abgleich klappt gerade nicht. Die Seite versucht es weiter; Änderungen anderer siehst
        du, sobald er wieder klappt.
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
            id="bereich-{eintrag.id}"
            aria-selected={bereich === eintrag.id}
            aria-controls="bereich-panel-{eintrag.id}"
            tabindex={bereich === eintrag.id ? 0 : -1}
            class={bereich === eintrag.id ? 'btn-primary' : 'btn-secondary'}
            onclick={() => (bereich = eintrag.id)}
            onkeydown={bereichTaste}>{eintrag.label}</button
          >
        {/each}
      </div>
    {/if}

    <!-- All areas stay mounted, so switching keeps what is typed in another one -->
    <div
      role="tabpanel"
      id="bereich-panel-plan"
      aria-labelledby="bereich-plan"
      hidden={bereich !== 'plan'}
    >
      <PlanTage {kontext} />
    </div>
    <div
      role="tabpanel"
      id="bereich-panel-gerichte"
      aria-labelledby="bereich-gerichte"
      hidden={bereich !== 'gerichte'}
    >
      <PlanGerichte {kontext} sichtbar={bereich === 'gerichte'} />
    </div>
    <div
      role="tabpanel"
      id="bereich-panel-teilnehmende"
      aria-labelledby="bereich-teilnehmende"
      hidden={bereich !== 'teilnehmende'}
    >
      <PlanTeilnehmende {kontext} sichtbar={bereich === 'teilnehmende'} />
    </div>
    {#if ansicht.zugang !== 'lesen'}
      <div
        role="tabpanel"
        id="bereich-panel-mitglieder"
        aria-labelledby="bereich-mitglieder"
        hidden={bereich !== 'mitglieder'}
      >
        <PlanMitglieder {kontext} />
      </div>
      <div
        role="tabpanel"
        id="bereich-panel-einstellungen"
        aria-labelledby="bereich-einstellungen"
        hidden={bereich !== 'einstellungen'}
      >
        <PlanEinstellungen {kontext} />
      </div>
    {/if}

    <PlanAenderungen aenderungen={ansicht.aenderungen} />
  </div>
{/if}
