<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import MitschriftNotizen from './MitschriftNotizen.svelte';
  import MitschriftTranskript from './MitschriftTranskript.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { MitschriftRecorder, isFirefox } from '../../lib/mitschriftRecorder.svelte';
  import type { SourceState } from '../../lib/mitschriftRecorder.svelte';
  import type { MitschriftDetail } from '../../lib/types';

  interface Props {
    mitschrift: MitschriftDetail;
    user: string;
    /** The recording ended; the parent generates the final notes. */
    onfinished: (detail: MitschriftDetail) => Promise<void>;
    ondetail: (detail: MitschriftDetail) => void;
    onchange: () => Promise<void>;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
    /** Tells the parent whether this computer records, e.g. to hide the recovery prompt. */
    onrecording?: (recording: boolean) => void;
  }
  let { mitschrift, user, onfinished, ondetail, onchange, notify, onrecording }: Props = $props();

  const SOURCE_STATE: Record<
    SourceState,
    { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
  > = {
    startet: { label: 'verbindet …', tone: 'neutral' },
    laeuft: { label: 'läuft', tone: 'success' },
    unterbrochen: { label: 'unterbrochen', tone: 'danger' },
    pausiert: { label: 'pausiert', tone: 'warning' },
    beendet: { label: 'beendet', tone: 'neutral' },
  };

  let recorder = $state<MitschriftRecorder | null>(null);
  let busy = $state<'start' | 'teams' | 'pause' | 'finish' | null>(null);
  let error = $state<string | null>(null);
  /** Ending without recording here (e.g. after a crash) is confirmed first. */
  let confirmFinish = $state(false);
  const firefox = isFirefox();

  const recording = $derived(recorder !== null && recorder.status !== 'beendet');
  const interrupted = $derived(
    recorder !== null &&
      recorder.status === 'aufnahme' &&
      (recorder.saveFailing || recorder.sources.some((s) => s.state === 'unterbrochen'))
  );
  const openGaps = $derived(
    recorder?.gaps.filter((g) => g.state === 'wartet' || g.state === 'laeuft').length ?? 0
  );
  const lostGaps = $derived(
    recorder?.gaps.filter((g) => g.state === 'verloren' || g.state === 'fehler').length ?? 0
  );
  const teams = $derived(recorder?.sources.find((s) => s.source === 'teams'));

  function mediaError(caught: unknown, fallback: string): string {
    if (caught instanceof DOMException && caught.name === 'NotAllowedError') {
      return 'Der Zugriff wurde nicht erlaubt. Bitte im Browser freigeben.';
    }
    if (caught instanceof DOMException && caught.name === 'NotFoundError') {
      return 'Es wurde kein Mikrofon gefunden.';
    }
    if (caught instanceof ApiError || caught instanceof Error) return caught.message || fallback;
    return fallback;
  }

  async function start(): Promise<void> {
    busy = 'start';
    error = null;
    const next = new MitschriftRecorder({ mitschrift, user, onDetail: ondetail });
    try {
      await next.prepare();
      await next.addMicrophone();
      next.start();
      recorder = next;
      onrecording?.(true);
    } catch (caught: unknown) {
      next.dispose();
      error = mediaError(caught, 'Die Aufnahme konnte nicht gestartet werden.');
    } finally {
      busy = null;
    }
  }

  async function addTeams(): Promise<void> {
    if (!recorder) return;
    busy = 'teams';
    error = null;
    try {
      await recorder.addTeamsTab();
    } catch (caught: unknown) {
      error = mediaError(caught, 'Der Ton des Teams-Tabs konnte nicht geteilt werden.');
    } finally {
      busy = null;
    }
  }

  async function togglePause(): Promise<void> {
    if (!recorder) return;
    busy = 'pause';
    try {
      if (recorder.status === 'aufnahme') await recorder.pause();
      else recorder.start();
    } finally {
      busy = null;
    }
  }

  async function finish(): Promise<void> {
    busy = 'finish';
    error = null;
    try {
      await recorder?.finish();
      const detail = await sendApi<MitschriftDetail>(
        'POST',
        `/intern/pflege/mitschriften/${mitschrift.id}/abschliessen`
      );
      recorder?.dispose();
      recorder = null;
      onrecording?.(false);
      await onfinished(detail);
    } catch (caught: unknown) {
      error = mediaError(
        caught,
        'Die Aufnahme konnte nicht beendet werden. Bitte erneut versuchen.'
      );
    } finally {
      busy = null;
    }
  }

  $effect(() => {
    if (!recording) return;
    // Leaving the page would end the recording
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  $effect(() => () => recorder?.dispose());
</script>

<section aria-labelledby="live-heading" class="space-y-4">
  <h2 id="live-heading" class="font-serif text-2xl text-brand-900">Live-Aufnahme</h2>

  {#if !recorder}
    <div class="max-w-prose space-y-2 text-sm text-neutral-700">
      <p>
        Das Mikrofon (am besten der Konferenzlautsprecher in der Tischmitte) wird live
        transkribiert. Sind Externe über Teams dabei, teile zusätzlich den Ton des Teams-Tabs: Die
        Echounterdrückung des Lautsprechers filtert sie sonst aus dem Mikrofon heraus.
      </p>
      <p>
        Das Audio geht direkt vom Browser zu Azure Speech. Nur noch nicht transkribierte Teile
        liegen kurz verschlüsselt in diesem Browser, damit bei einem Verbindungsabbruch nichts
        verloren geht.
      </p>
      {#if mitschrift.abschnitte.length > 0}
        <p class="text-warning">
          Diese Mitschrift hat schon ein Transkript. Läuft die Aufnahme noch auf einem anderen
          Gerät, mach bitte dort weiter.
        </p>
      {/if}
    </div>
    <div class="flex flex-wrap gap-2">
      <ActionButton
        variant="primary"
        disabled={busy !== null}
        aria-busy={busy === 'start'}
        onclick={start}
      >
        {busy === 'start' ? 'Wird gestartet …' : 'Aufnahme starten'}
      </ActionButton>
      {#if confirmFinish}
        <ActionButton
          variant="danger"
          disabled={busy !== null}
          aria-busy={busy === 'finish'}
          onclick={finish}
        >
          Ja, Aufnahme beenden
        </ActionButton>
        <ActionButton disabled={busy !== null} onclick={() => (confirmFinish = false)}>
          Abbrechen
        </ActionButton>
      {:else}
        <ActionButton disabled={busy !== null} onclick={() => (confirmFinish = true)}>
          Aufnahme beenden
        </ActionButton>
      {/if}
    </div>
    {#if confirmFinish}
      <p class="text-sm text-warning" role="alert">
        Damit endet die Mitschrift, ohne dass hier aufgenommen wird, etwa nachdem der aufnehmende
        Rechner abgestürzt ist. Läuft die Aufnahme noch auf einem anderen Gerät, dort beenden.
      </p>
    {/if}
  {:else}
    {#if interrupted}
      <p class="border-l-2 border-danger py-1 pl-4 text-sm font-semibold text-danger" role="alert">
        {recorder.cacheSupported
          ? 'Verbindung unterbrochen – Aufnahme wird lokal gesichert.'
          : 'Verbindung unterbrochen – dieser Browser kann die Aufnahme nicht lokal sichern.'}
      </p>
    {/if}

    <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
      {#each recorder.sources as source (source.source)}
        <p class="text-sm">
          <span class="font-semibold">{source.source === 'teams' ? 'Teams' : 'Raum'}:</span>
          <StatusLabel {...SOURCE_STATE[source.state]} />
          {#if source.error}<span class="text-warning"> – {source.error}</span>{/if}
        </p>
      {/each}
      {#if recorder.status === 'pausiert'}
        <StatusLabel label="Pausiert – es geht kein Audio an Azure" tone="warning" />
      {/if}
    </div>

    {#if openGaps > 0}
      <p class="text-sm text-neutral-700" aria-live="polite">
        {openGaps === 1 ? 'Eine Lücke wird' : `${openGaps} Lücken werden`} aus der lokalen Sicherung nachtranskribiert.
      </p>
    {/if}
    {#if lostGaps > 0}
      <p class="text-sm text-warning">
        {lostGaps === 1 ? 'Eine Lücke konnte' : `${lostGaps} Lücken konnten`} nicht nachtranskribiert
        werden.
      </p>
    {/if}

    <div class="flex flex-wrap gap-2">
      <ActionButton
        variant={recorder.status === 'aufnahme' ? 'secondary' : 'primary'}
        disabled={busy !== null || recorder.status === 'beendet'}
        aria-pressed={recorder.status === 'pausiert'}
        onclick={togglePause}
      >
        {recorder.status === 'aufnahme' ? 'Pause' : 'Fortsetzen'}
      </ActionButton>
      {#if !teams || teams.state === 'beendet'}
        <ActionButton
          disabled={busy !== null || recorder.status === 'beendet'}
          aria-busy={busy === 'teams'}
          aria-describedby="teams-hint"
          onclick={addTeams}
        >
          {teams ? 'Teams-Ton erneut teilen' : 'Teams-Ton hinzufügen'}
        </ActionButton>
      {/if}
      <ActionButton
        variant="danger"
        disabled={busy !== null}
        aria-busy={busy === 'finish'}
        onclick={finish}
      >
        {busy === 'finish'
          ? 'Wird beendet …'
          : recorder.status === 'beendet'
            ? 'Beenden erneut versuchen'
            : 'Aufnahme beenden'}
      </ActionButton>
    </div>
    {#if !teams || teams.state === 'beendet'}
      <p id="teams-hint" class="text-xs text-neutral-700">
        {#if firefox}
          Firefox gibt den Ton eines Tabs nicht weiter. Für Externe aus Teams bitte Chrome, Edge
          oder Chromium verwenden.
        {:else}
          Im Dialog den Tab mit Teams wählen und „Tab-Audio teilen“ einschalten.
        {/if}
      </p>
    {/if}
    {#if !recorder.wakeLockActive && recorder.status === 'aufnahme'}
      <p class="text-xs text-neutral-700">
        Der Bildschirm kann sich sperren; bitte die automatische Sperre für die Dauer des Meetings
        ausschalten.
      </p>
    {/if}
  {/if}

  {#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
</section>

{#if recorder}
  <div class="grid gap-8 lg:grid-cols-[3fr_2fr]">
    <MitschriftTranskript
      {mitschrift}
      sprecher={recorder.sprecher}
      pending={recorder.sentences.map((s) => ({ ...s, key: s.clientId }))}
      partials={recorder.sources
        .filter((s) => s.partial)
        .map((s) => ({ source: s.source, text: s.partial }))}
      {onchange}
      ondeleted={onchange}
      {notify}
    />
    <div class="space-y-3">
      <MitschriftNotizen {mitschrift} running preview={recorder.notes} {onchange} {notify} />
      {#if recorder.notesError}<p class="text-sm text-warning">{recorder.notesError}</p>{/if}
      <ActionButton onclick={() => recorder?.refreshNotes()}
        >Laufende Notizen jetzt aktualisieren</ActionButton
      >
    </div>
  </div>
{/if}
