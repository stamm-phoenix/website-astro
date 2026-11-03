<script lang="ts">
  import { onMount } from 'svelte';
  import { CHANGELOG } from '../../lib/changelogEntries';
  import { changeText, recentUnseenEntries } from '../../lib/changelog';
  import { staffPage } from '../../lib/staffModules';
  import { formatDay } from '../../lib/format';
  import {
    changelogStore,
    INITIAL_UNREAD_LIMIT,
    loadChangelogSeen,
    markChangelogSeen,
  } from '../../lib/staffChangelogStore.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';

  type Phase = 'loading' | 'loadFailed' | 'ready' | 'saving' | 'saved' | 'saveFailed';

  /** The recent entries shown as new; historic entries remain available in the list below. */
  let newIds = $state<string[]>([]);
  let phase = $state<Phase>('loading');

  async function open(): Promise<void> {
    phase = 'loading';
    // Without a fresh state nothing can be called new, and nothing is marked as read
    if (!(await loadChangelogSeen())) {
      phase = 'loadFailed';
      return;
    }
    newIds = recentUnseenEntries(CHANGELOG, changelogStore.lastSeenId, INITIAL_UNREAD_LIMIT).map(
      (entry) => entry.id
    );
    phase = 'ready';
  }

  async function markAllRead(): Promise<void> {
    phase = 'saving';
    if (await markChangelogSeen()) {
      newIds = [];
      phase = 'saved';
    } else {
      phase = 'saveFailed';
    }
  }

  onMount(open);
</script>

<div role="status" aria-live="polite">
  {#if phase === 'loading' || phase === 'saving'}
    <p class="mb-4 text-sm text-neutral-700">
      {phase === 'loading' ? 'Neuigkeiten werden geladen …' : 'Gelesen wird gespeichert …'}
    </p>
  {:else if phase === 'loadFailed'}
    <div class="mb-4 border-l-4 border-danger py-2 pl-4 text-sm text-neutral-800">
      <strong class="text-danger">Neuigkeiten nicht als neu oder gelesen markiert.</strong>
      <MessageText text={changelogStore.loadError ?? ''} />
      Die Neuigkeiten stehen unten, es wurde nichts als gelesen gespeichert.
      <div>
        <ActionButton variant="secondary" type="button" class="mt-3" onclick={open}
          >Erneut versuchen</ActionButton
        >
      </div>
    </div>
  {:else if phase === 'saveFailed'}
    <p class="mb-4 border-l-4 border-warning py-2 pl-4 text-sm text-neutral-800">
      <strong class="text-warning">Nicht als gelesen gespeichert.</strong>
      <MessageText text={changelogStore.saveError ?? ''} />
      Die Zahl am Menü bleibt deshalb stehen.
    </p>
  {:else if phase === 'saved'}
    <p class="mb-4 text-sm text-neutral-700">Alle Neuigkeiten sind als gelesen gespeichert.</p>
  {:else if newIds.length > 0}
    <p class="mb-4 text-sm text-neutral-700">
      {newIds.length === 1 ? 'Eine Neuigkeit' : `${newIds.length} Neuigkeiten`} für dich.
    </p>
  {:else}
    <p class="mb-4 text-sm text-neutral-700">Du bist auf dem neuesten Stand.</p>
  {/if}
  {#if (phase === 'ready' && newIds.length > 0) || phase === 'saveFailed'}
    <ActionButton variant="secondary" type="button" class="mb-4" onclick={markAllRead}>
      Alle als gelesen markieren
    </ActionButton>
  {/if}
</div>

<ol class="space-y-4">
  {#each CHANGELOG as entry (entry.id)}
    <li>
      <article class="surface p-4" aria-labelledby="neuigkeit-{entry.id}">
        <div class="flex flex-wrap items-baseline gap-x-3">
          <h2 id="neuigkeit-{entry.id}" class="font-serif text-lg font-semibold text-brand-900">
            {entry.title}
          </h2>
          {#if newIds.includes(entry.id)}<StatusLabel label="Neu" tone="danger" dot />{/if}
        </div>
        <p class="mt-0.5 text-sm text-neutral-700">
          <time datetime={entry.date}>{formatDay(entry.date)}</time>
        </p>
        <ul class="mt-2 list-disc space-y-1.5 pl-5 text-neutral-800">
          {#each entry.changes as change (changeText(change))}
            <li>
              {changeText(change)}
              {#if typeof change !== 'string'}
                <a href={change.href} class="ml-1 inline-block py-2.5 font-semibold text-link"
                  >„{staffPage(change.href).title}“ öffnen</a
                >
              {/if}
            </li>
          {/each}
        </ul>
      </article>
    </li>
  {/each}
</ol>
