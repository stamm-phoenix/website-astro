<script lang="ts">
  import { postApi } from '../lib/api';
  import { dateToLocalParts } from '../lib/nikolausConfig';
  import type { NikolausVisitProgress } from '../lib/types';

  interface Props {
    /** Management token of the booking. */
    token: string;
    /** Date of the visit (`YYYY-MM-DD`). */
    date: string;
    /**
     * Set by the component: `visited` once the team has checked off the visit, `after` from the
     * day after the visit on. The page then thanks the family instead of showing the booking state.
     */
    finished?: 'visited' | 'after' | null;
  }

  let { token, date, finished = $bindable(null) }: Props = $props();

  /** How often the progress is reloaded on the visit day. */
  const REFRESH_MS = 120_000;
  /** From this delay on, the family is told that the Nikolaus comes later than planned. */
  const NOTABLE_DELAY_MINUTES = 10;
  /** Dots of the progress bar; longer routes only show the last ones. */
  const MAX_DOTS = 12;

  let progress = $state<NikolausVisitProgress | null>(null);
  let today = $state(berlinDate());

  const isBefore = $derived(today < date);
  const isVisitDay = $derived(today === date);
  const isAfter = $derived(today > date);
  /** The next Nikolausdienst: its booking opens in October of the following year. */
  const nextYear = $derived(Number(date.slice(0, 4)) + 1);

  $effect(() => {
    finished = isAfter
      ? 'after'
      : isVisitDay && progress?.phase === 'today' && progress.visited
        ? 'visited'
        : null;
  });

  /** Today in the time zone of the Nikolausdienst. */
  function berlinDate(): string {
    return dateToLocalParts(new Date()).date;
  }

  // The page may stay open over midnight, e.g. from the evening before the visit
  $effect(() => {
    const timer = setInterval(() => (today = berlinDate()), 60_000);
    return () => clearInterval(timer);
  });

  async function load(): Promise<void> {
    try {
      progress = await postApi<NikolausVisitProgress>('/nikolaus/manage/progress', { token });
    } catch {
      // Keep the last state; the next refresh tries again
    }
  }

  // Only on the visit day: load now, then regularly while the page is visible
  $effect(() => {
    if (!isVisitDay) return;
    void load();
    const refresh = (): void => {
      today = berlinDate();
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  });
</script>

{#snippet nextSteps()}
  <section class="surface p-5 md:p-6" aria-labelledby="visit-next-heading">
    <h3 id="visit-next-heading" class="font-serif text-xl font-semibold text-brand-900">
      Wie geht es weiter?
    </h3>
    <p class="mt-2 text-neutral-800">
      Nach der Löschung Ihrer Angaben zum Nikolausbesuch funktioniert der Link zu dieser Seite nicht
      mehr. Bei Fragen zu Ihren gespeicherten Angaben erreichen Sie uns über
      <a class="underline underline-offset-2" href="/kontakt">unsere Kontaktseite</a>.
    </p>
    <p class="mt-2 text-neutral-800">
      Ab Oktober {nextYear} können Sie sich wieder für den Nikolausdienst anmelden. Wir freuen uns auf
      Sie!
    </p>
  </section>
{/snippet}

{#if isBefore}
  <div class="border-l-4 border-[var(--color-brand-300)] py-1 pl-4 text-sm text-brand-900">
    <p>
      <strong>Am Besuchstag</strong> sehen Sie hier, wie viele Besuche der Nikolaus noch vor Ihnen hat
      und wann er voraussichtlich bei Ihnen ist. Speichern Sie sich diesen Link am besten gut ab.
    </p>
  </div>
{:else if finished}
  {@render nextSteps()}
{:else if isVisitDay && progress && (progress.phase === 'planning' || progress.phase === 'today')}
  <section
    class="surface p-5 md:p-6"
    aria-labelledby="visit-progress-heading"
    role="status"
    aria-live="polite"
  >
    <h3 id="visit-progress-heading" class="font-serif text-xl font-semibold text-brand-900">
      Ihr Nikolausbesuch heute
    </h3>

    {#if progress.phase === 'planning'}
      <p class="mt-2 text-neutral-800">
        Die Tourenplanung für heute läuft noch. Schauen Sie später wieder vorbei – dann sehen Sie
        hier, wann der Nikolaus voraussichtlich bei Ihnen ist.
      </p>
    {:else if progress.phase === 'today' && progress.eta === null}
      <p class="mt-2 text-lg text-neutral-900">
        Der Nikolaus ist unterwegs und müsste bald bei Ihnen sein. Danke für Ihre Geduld!
      </p>
    {:else if progress.phase === 'today'}
      <p class="mt-2 text-lg text-neutral-900">
        {#if !progress.started}
          Sie sind der <strong>{progress.position}. Besuch</strong> auf der Tour des Nikolaus.
        {:else if progress.stopsAhead === 0}
          <strong>Der Nikolaus ist als Nächstes bei Ihnen!</strong>
        {:else}
          Der Nikolaus ist noch
          <strong
            >{progress.stopsAhead}
            {progress.stopsAhead === 1 ? 'Besuch' : 'Besuche'}</strong
          >
          von Ihnen entfernt.
        {/if}
      </p>

      {#if progress.started && progress.stopsAhead > 0}
        <div class="mt-3 flex max-w-md items-center gap-2" aria-hidden="true">
          <span class="text-lg">🎅</span>
          {#each { length: Math.min(progress.stopsAhead, MAX_DOTS) }, i (i)}
            <span class="size-2.5 shrink-0 rounded-full bg-[var(--color-brand-300)]"></span>
          {/each}
          <span class="text-lg">🏠</span>
        </div>
      {/if}

      <p class="mt-3 text-neutral-800">
        Voraussichtlich <strong>ca. {progress.eta} Uhr</strong>
        {#if progress.delayMinutes >= NOTABLE_DELAY_MINUTES}
          <span class="block text-sm text-[#8a4a00]">
            Das ist etwa {progress.delayMinutes} Minuten später als geplant – danke für Ihre Geduld!
          </span>
        {/if}
      </p>
      <p class="mt-2 text-xs text-neutral-700">Die Anzeige aktualisiert sich alle paar Minuten.</p>
    {/if}
  </section>
{/if}
