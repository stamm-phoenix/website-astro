<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ApiError, sendApi } from '../lib/api';
  import { fetchStufen, stufenStore } from '../lib/nikolausHelfendeStore.svelte';
  import { GROUP_CONFIG, STUFE_TO_KEY } from '../lib/types';
  import type { StaffNikolausStufenSuggestion } from '../lib/types';
  import StatusNotice from './pflege/StatusNotice.svelte';

  interface Props {
    /** Called after a suggestion was accepted, so helpers and Einteilung are reloaded. */
    onchanged: () => Promise<void>;
  }

  let { onchanged }: Props = $props();

  const busy = new SvelteSet<string>();
  let notice = $state<{ text: string; kind: 'success' | 'warning' | 'error' } | null>(null);

  const MATCH_LABEL: Record<StaffNikolausStufenSuggestion['match'], string> = {
    'name-address': 'Name + Adresse',
    address: 'nur Adresse',
    leitung: 'leitet die Stufe',
  };

  const suggestions = $derived(stufenStore.data?.suggestions ?? []);
  const families = $derived(suggestions.filter((s) => s.kind === 'booking'));
  const helpers = $derived(suggestions.filter((s) => s.kind === 'helper'));
  const sureFamilies = $derived(families.filter((s) => s.match === 'name-address'));

  function stufeColor(stufe: string): string {
    const key = STUFE_TO_KEY[stufe];
    return key ? GROUP_CONFIG[key].color : 'var(--color-brand-800)';
  }

  /** Sends the decision; returns whether it worked. */
  async function send(
    suggestion: StaffNikolausStufenSuggestion,
    decision: 'accept' | 'reject'
  ): Promise<boolean> {
    busy.add(suggestion.id);
    try {
      await sendApi('POST', '/intern/pflege/nikolaus-stufen-abgleich', {
        kind: suggestion.kind,
        targetId: suggestion.targetId,
        stufe: suggestion.stufe,
        decision,
      });
      if (stufenStore.data) {
        stufenStore.data.suggestions = stufenStore.data.suggestions.filter(
          (s) => s.id !== suggestion.id
        );
      }
      return true;
    } catch (err: unknown) {
      const reason = err instanceof ApiError ? err.message : 'Bitte versuche es erneut.';
      notice = { text: `${suggestion.targetName}: ${reason}`, kind: 'error' };
      return false;
    } finally {
      busy.delete(suggestion.id);
    }
  }

  async function decide(
    suggestion: StaffNikolausStufenSuggestion,
    decision: 'accept' | 'reject'
  ): Promise<void> {
    if (!(await send(suggestion, decision))) return;
    notice = {
      text:
        decision === 'accept'
          ? `${suggestion.targetName}: Tag „${suggestion.stufe}“ vergeben.`
          : `${suggestion.targetName}: Vorschlag „${suggestion.stufe}“ abgelehnt.`,
      kind: 'success',
    };
    if (decision === 'accept') await onchanged();
  }

  async function acceptAllSure(): Promise<void> {
    const pending = [...sureFamilies];
    // Block every pending suggestion, so it cannot be answered by hand during the run
    for (const suggestion of pending) busy.add(suggestion.id);
    let accepted = 0;
    try {
      for (const suggestion of pending) {
        if (await send(suggestion, 'accept')) accepted++;
      }
    } finally {
      for (const suggestion of pending) busy.delete(suggestion.id);
    }
    if (accepted === pending.length) {
      notice = { text: `${accepted} Vorschläge angenommen.`, kind: 'success' };
    }
    if (accepted > 0) await onchanged();
  }
</script>

{#snippet list(items: StaffNikolausStufenSuggestion[], tagHint: string)}
  <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
    {#each items as suggestion (suggestion.id)}
      <li class="flex flex-wrap items-start justify-between gap-3 py-3">
        <div class="min-w-0 space-y-1">
          <p class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-brand-900">{suggestion.targetName}</span>
            <span class="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
              <span
                aria-hidden="true"
                class="size-2 rounded-full"
                style:background-color={stufeColor(suggestion.stufe)}
              ></span>
              <span class="sr-only">{tagHint}</span>
              {suggestion.stufe}
            </span>
            <span
              class="text-xs {suggestion.match === 'address'
                ? 'font-semibold text-warning'
                : 'text-neutral-700'}"
            >
              {MATCH_LABEL[suggestion.match]}
            </span>
          </p>
          {#if suggestion.kind === 'booking'}
            <p class="text-sm text-neutral-700">
              Gleiche Adresse wie {suggestion.evidence.join(', ')}
            </p>
          {/if}
        </div>
        <div class="flex gap-2">
          <ActionButton
            variant="primary"
            type="button"
            class="px-3! py-1! text-xs!"
            disabled={busy.has(suggestion.id)}
            onclick={() => decide(suggestion, 'accept')}
          >
            Annehmen<span class="sr-only"> ({suggestion.targetName}, {suggestion.stufe})</span>
          </ActionButton>
          <ActionButton
            variant="secondary"
            type="button"
            class="px-3! py-1! text-xs!"
            disabled={busy.has(suggestion.id)}
            onclick={() => decide(suggestion, 'reject')}
          >
            Ablehnen<span class="sr-only"> ({suggestion.targetName}, {suggestion.stufe})</span>
          </ActionButton>
        </div>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="space-y-6">
  <div class="max-w-3xl space-y-3">
    <p class="text-sm text-neutral-700">
      Vergleicht die Anmeldungen mit der Mitgliederliste in CampFlow und die Helfenden mit den
      Leitenden. Familien bekommen die Stufe ihrer Kinder als Tag, Leitende die Stufe als negatives
      Tag – so fährt niemand zu Kindern aus der eigenen Stufe. Abgelehnte Vorschläge werden nicht
      erneut angezeigt.
    </p>
    <ActionButton
      variant="primary"
      type="button"
      disabled={stufenStore.loading}
      onclick={() => fetchStufen()}
    >
      {stufenStore.data ? 'Erneut abgleichen' : 'Mit CampFlow abgleichen'}
    </ActionButton>
  </div>

  <StatusNotice message={notice?.text ?? null} kind={notice?.kind} />

  {#if stufenStore.loading}
    <div role="status" aria-live="polite" class="surface p-6">
      <span class="sr-only">Abgleich läuft …</span>
      <div class="skeleton-element h-6 w-56 rounded"></div>
      <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    </div>
  {:else if stufenStore.error}
    <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
      <h2 class="text-lg font-semibold text-brand-900">Der Abgleich hat nicht geklappt</h2>
      <p class="mt-1 text-sm text-neutral-700">
        CampFlow oder SharePoint ist gerade nicht erreichbar. Bitte versuche es erneut.
      </p>
    </div>
  {:else if stufenStore.data}
    {#if suggestions.length === 0}
      <p class="surface p-6 text-sm text-neutral-800">Keine offenen Vorschläge.</p>
    {/if}

    {#if families.length > 0}
      <section aria-labelledby="stufen-familien" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="stufen-familien" class="font-serif text-xl text-brand-900">
            Familien ({families.length})
          </h2>
          {#if sureFamilies.length > 1}
            <ActionButton
              variant="secondary"
              type="button"
              class="px-3! py-1! text-xs!"
              disabled={busy.size > 0}
              onclick={acceptAllSure}
            >
              Alle mit „Name + Adresse“ annehmen ({sureFamilies.length})
            </ActionButton>
          {/if}
        </div>
        {@render list(families, 'Tag:')}
      </section>
    {/if}

    {#if helpers.length > 0}
      <section aria-labelledby="stufen-helfende" class="space-y-3">
        <h2 id="stufen-helfende" class="font-serif text-xl text-brand-900">
          Helfende ({helpers.length})
        </h2>
        {@render list(helpers, 'Negatives Tag:')}
      </section>
    {/if}
  {/if}
</div>
