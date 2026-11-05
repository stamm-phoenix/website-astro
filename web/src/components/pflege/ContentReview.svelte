<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteDate } from 'svelte/reactivity';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { contentReviews as resource } from '../../lib/contentReviewStore.svelte';
  import { sendApi, errorMessage } from '../../lib/api';
  import type { ContentReviewItem } from '../../../../api/lib/content-review-model';

  const id = $props.id();
  const labels = {
    blog: 'Blog',
    faq: 'Fragen & Antworten',
    gruppenstunde: 'Gruppenstunden',
    leitende: 'Leitende',
    aktion: 'Aktionen',
    download: 'Downloads',
  };
  const links = {
    blog: 'blog',
    faq: 'fragen-und-antworten',
    gruppenstunde: 'gruppenstunden',
    leitende: 'leitende',
    aktion: 'aktionen',
    download: 'downloads',
  };
  let filter = $state('all');
  let kind = $state('all');
  let success = $state('');
  let busy = $state<string | null>(null);
  let messages = $state<Record<string, { text: string; error: boolean }>>({});
  const options = [
    { value: 'all', label: 'Alle' },
    { value: 'never', label: 'Ungeprüft' },
    { value: 'stale', label: 'Prüfung fällig' },
  ];
  const cutoff = new SvelteDate();
  cutoff.setMonth(cutoff.getMonth() - 6);
  function due(item: ContentReviewItem): boolean {
    return !item.reviewedAt || item.changedSinceReview || new Date(item.reviewedAt) <= cutoff;
  }
  const visible = $derived(
    (resource.state.data ?? []).filter(
      (item) =>
        (kind === 'all' || item.kind === kind) &&
        (filter === 'all' || (filter === 'never' ? !item.reviewedAt : due(item)))
    )
  );
  const date = (value: string): string =>
    new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const key = (item: ContentReviewItem): string => `${item.kind}/${item.id}`;
  async function review(item: ContentReviewItem): Promise<void> {
    const id = key(item);
    busy = id;
    success = '';
    delete messages[id];
    try {
      const updated = await sendApi<ContentReviewItem>(
        'POST',
        `/intern/pflege/content-review/${id}`,
        { etag: item.etag }
      );
      resource.set((resource.state.data ?? []).map((row) => (key(row) === id ? updated : row)));
      success = `„${item.title}“ als geprüft markiert.`;
    } catch (error) {
      messages[id] = {
        text: errorMessage(
          error,
          'Die Prüfung wurde nicht gespeichert. Lade die Übersicht neu und versuche es erneut.'
        ),
        error: true,
      };
    } finally {
      busy = null;
    }
  }
  $effect(() => {
    untrack(() => resource.load());
  });
</script>

<div class="mb-6 space-y-4">
  <div class="flex items-center gap-2">
    <FilterTabs
      label="Prüfstatus"
      {options}
      value={filter}
      onselect={(value) => (filter = value)}
    />
    <InfoHint
      label="Prüfung fällig"
      text="Ungeprüfte, seit der Prüfung geänderte und seit mindestens sechs Monaten nicht geprüfte Inhalte."
    />
  </div>
  <div>
    <label for={`${id}-kind`} class="block font-semibold">Bereich</label>
    <select
      id={`${id}-kind`}
      class="mt-1 block min-h-11 w-full rounded border border-[var(--field-border)] bg-[var(--color-surface)] p-2"
      bind:value={kind}
    >
      <option value="all">Alle Bereiche</option>
      {#each Object.entries(labels) as [value, label] (value)}<option {value}>{label}</option
        >{/each}
    </select>
  </div>
  <ActionButton type="button" variant="secondary" onclick={() => resource.load({ force: true })}
    >Neu laden</ActionButton
  >
</div>
<p role="status" aria-live="polite" class="mb-3">{success}</p>
<LoadState {...resource.state} onretry={() => resource.load({ force: true })}>
  <p class="mb-3 text-sm" role="status">{visible.length} Einträge</p>
  {#if visible.length === 0}<p>Keine passenden Inhalte.</p>{/if}
  <ul class="grid gap-4 lg:grid-cols-2">
    {#each visible as item (key(item))}
      <li class="surface min-w-0 rounded-lg p-4">
        <p class="text-sm text-neutral-700">{labels[item.kind]}</p>
        <h2 class="mb-2 break-words text-lg font-semibold">{item.title}</h2>
        <a
          class="mb-3 mr-3 inline-flex min-h-11 items-center text-link underline"
          href={`/leitendenbereich/${links[item.kind]}`}>{labels[item.kind]} öffnen</a
        >
        <StatusLabel
          label={!item.reviewedAt
            ? 'Ungeprüft'
            : item.changedSinceReview
              ? 'Seit Prüfung geändert'
              : due(item)
                ? 'Prüfung fällig'
                : 'Geprüft'}
          tone={due(item) ? 'warning' : 'success'}
        />
        {#if item.campflowOwned}<InfoHint
            label="Website-Inhalte der Aktion"
            text="Der Prüfvermerk gilt für die auf der Website bearbeiteten Inhalte, insbesondere Stufen und Beschreibung. Titel und Termine aus CampFlow sind davon ausgenommen."
          />{/if}
        <dl class="my-4 space-y-2 text-sm">
          <div>
            <dt class="font-semibold">Zuletzt geändert</dt>
            <dd class="break-words">
              {date(item.updatedAt)} · {item.updatedBy || 'Person nicht hinterlegt'}
            </dd>
          </div>
          <div>
            <dt class="font-semibold">Zuletzt geprüft</dt>
            <dd class="break-words">
              {item.reviewedAt
                ? `${date(item.reviewedAt)} · ${item.reviewedBy || 'Person nicht hinterlegt'}`
                : 'Noch nicht geprüft'}
            </dd>
          </div>
        </dl>
        <ActionButton type="button" disabled={busy !== null} onclick={() => review(item)}
          >{busy === key(item) ? 'Wird markiert …' : 'Als geprüft markieren'}</ActionButton
        >
        {#if messages[key(item)]}<p
            class="mt-2 text-sm"
            role={messages[key(item)].error ? 'alert' : 'status'}
          >
            {messages[key(item)].text}
          </p>{/if}
      </li>
    {/each}
  </ul>
</LoadState>
