<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ProtokollAnsicht from './ProtokollAnsicht.svelte';
  import { errorMessage, fetchApi } from '../../lib/api';
  import { changedPunkte, formatTime, praesentationChannel } from '../../lib/protokollEditor';
  import type { PraesentationMessage, ProtokollStand } from '../../lib/protokollEditor';
  import type { ProtokollEditorDetail, ProtokollLiveResponse } from '../../lib/types';

  /**
   * The minutes for the TV and the screen share in Teams, in a window of their own: only the
   * text, large and calm, without any editing. The writing tab of the same browser sends every
   * change at once (`BroadcastChannel`); otherwise the window asks the server every few
   * seconds, like the read view. Each change scrolls to the item being written.
   */

  const POLL_MS = 2500;
  /** After a change from the writing tab, the server is behind for a moment; ignore it then. */
  const DIRECT_MS = 15_000;

  let id: number | null = null;
  let etag = '';
  let stand = $state.raw<ProtokollStand | null>(null);
  let active = $state<string | null>(null);
  let changed = $state.raw<Set<string>>(new Set());
  let updatedAt = $state<string | null>(null);
  let writer = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let lastDirect = 0;
  let changedTimer: ReturnType<typeof setTimeout> | undefined;

  /** Shows a new version, lights up what changed and scrolls to where it happened. */
  async function show(next: ProtokollStand, nextActive: string | null): Promise<void> {
    const previous = stand;
    const diff = previous ? changedPunkte(previous.inhalt, next.inhalt) : new Set<string>();
    const sameContent = previous !== null && JSON.stringify(previous) === JSON.stringify(next);
    stand = next;
    updatedAt = new Date().toISOString();
    const moved = nextActive !== active;
    active = nextActive;
    if (diff.size > 0) {
      changed = diff;
      clearTimeout(changedTimer);
      changedTimer = setTimeout(() => (changed = new Set()), 2000);
    }
    if (sameContent && !moved) return;
    const target =
      (nextActive && (diff.has(nextActive) || moved) ? nextActive : null) ?? [...diff][0];
    if (!target) return;
    await tick();
    document
      .getElementById(`praesentation-${target}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** Whether the writing tab of this browser sent a version a moment ago. */
  function directRecently(): boolean {
    return lastDirect > 0 && Date.now() - lastDirect < DIRECT_MS;
  }

  function fromDetail(detail: ProtokollEditorDetail): ProtokollStand {
    return { title: detail.title, date: detail.date, inhalt: detail.inhalt };
  }

  async function load(): Promise<void> {
    if (id === null) return;
    try {
      // Only reads: no tab token, so the window never counts as the writing tab
      const detail = await fetchApi<ProtokollEditorDetail>(`/intern/protokoll-editor/${id}`);
      loadError = null;
      writer = detail.sperre && !detail.sperre.expired ? detail.sperre.name : null;
      document.title = `${detail.title} – Präsentation`;
      // The writing tab may have answered first; its version is newer than the server's. The
      // version stays unknown, so the next check brings the server's version once it counts
      if (directRecently()) return;
      etag = detail.etag;
      await show(fromDetail(detail), writer ? (detail.sperre?.aktiverPunkt ?? null) : null);
    } catch (error: unknown) {
      loadError = errorMessage(error, 'Das Protokoll konnte nicht geladen werden.');
    }
  }

  async function poll(): Promise<void> {
    if (id === null || document.visibilityState !== 'visible') return;
    if (!stand) {
      // The first load failed (e.g. a short network error): try again, the window has no reload
      await load();
      return;
    }
    try {
      const live = await fetchApi<ProtokollLiveResponse>(
        `/intern/protokoll-editor/${id}/live?etag=${encodeURIComponent(etag)}`
      );
      writer = live.sperre && !live.sperre.expired ? live.sperre.name : null;
      // Keep the old version while ignoring the server, so its newer version comes again
      if (directRecently()) return;
      etag = live.etag;
      const nextActive = writer ? (live.sperre?.aktiverPunkt ?? null) : null;
      if (live.protokoll) await show(fromDetail(live.protokoll), nextActive);
      else if (nextActive !== active) await show(stand, nextActive);
    } catch {
      // The next check tries again
    }
  }

  const statusLine = $derived(
    [
      writer ? `${writer} schreibt` : '',
      updatedAt ? `Live, zuletzt ${formatTime(updatedAt)}` : 'Live',
    ]
      .filter(Boolean)
      .join(' · ')
  );

  onMount(() => {
    const parsed = Number(new URL(window.location.href).searchParams.get('id'));
    if (!Number.isInteger(parsed) || parsed <= 0) {
      loadError = 'Kein Protokoll ausgewählt.';
      return;
    }
    id = parsed;
    void load();

    const channel = praesentationChannel(parsed);
    channel?.addEventListener('message', (event: MessageEvent<PraesentationMessage>) => {
      const message = event.data;
      if (message?.type === 'stand') {
        lastDirect = Date.now();
        loadError = null;
        void show(
          { title: message.title, date: message.date, inhalt: message.inhalt },
          message.aktiverPunkt
        );
      } else if (message?.type === 'ende') {
        lastDirect = 0;
      }
    });
    // A writing tab of this browser answers with its current version
    const hallo: PraesentationMessage = { type: 'hallo' };
    channel?.postMessage(hallo);

    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(changedTimer);
      channel?.close();
    };
  });
</script>

<div class="praesentation">
  {#if !stand && loadError}
    <p class="text-danger" role="alert">{loadError} Es wird gleich erneut versucht.</p>
  {:else if !stand}
    <p role="status" aria-live="polite" class="text-neutral-700">Protokoll wird geladen …</p>
  {:else}
    <ProtokollAnsicht
      title={stand.title}
      date={stand.date}
      inhalt={stand.inhalt}
      {changed}
      {active}
      idPrefix="praesentation"
      gross
    />
  {/if}
</div>

<p class="hinweis" aria-live="polite">{statusLine}</p>

<style>
  .praesentation {
    display: flex;
    justify-content: center;
    padding: 2.5rem 3rem 50vh;
  }
  .hinweis {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--color-neutral-200);
    background: var(--color-surface);
    font-size: 0.875rem;
    color: var(--color-neutral-700);
    opacity: 0.85;
  }
  @media (max-width: 40rem) {
    .praesentation {
      padding: 1.5rem 1rem 50vh;
    }
  }
</style>
