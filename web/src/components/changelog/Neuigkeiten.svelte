<script lang="ts">
  import { onMount } from 'svelte';
  import { CHANGELOG } from '../../lib/changelogEntries';
  import { unseenEntries } from '../../lib/changelog';
  import { formatDay } from '../../lib/format';
  import {
    changelogStore,
    loadChangelogSeen,
    markChangelogSeen,
  } from '../../lib/staffChangelogStore.svelte';
  import { HELP_CONTACTS } from '../../lib/helpContacts';
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';

  type Phase = 'loading' | 'loadFailed' | 'saving' | 'saved' | 'saveFailed';

  /** What was new when the page opened; the labels stay while the entries count as read. */
  let newIds = $state<string[]>([]);
  let phase = $state<Phase>('loading');

  async function open(): Promise<void> {
    phase = 'loading';
    await loadChangelogSeen();
    // Without the saved state nothing can be called new, and nothing is marked as read
    if (!changelogStore.loaded) {
      phase = 'loadFailed';
      return;
    }
    newIds = unseenEntries(CHANGELOG, changelogStore.lastSeenId).map((entry) => entry.id);
    phase = 'saving';
    phase = (await markChangelogSeen()) ? 'saved' : 'saveFailed';
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
      <strong class="text-danger">Dein Lesestand konnte nicht geladen werden.</strong>
      Die Neuigkeiten stehen unten, aber wir wissen nicht, welche du schon kennst. Es wurde nichts als
      gelesen gespeichert. Prüfe deine Internetverbindung und versuche es noch einmal. Hilft das nicht,
      schreib an
      <a href="mailto:{HELP_CONTACTS.technik}" class="font-semibold text-link"
        >{HELP_CONTACTS.technik}</a
      >.
      <div>
        <ActionButton variant="secondary" type="button" class="mt-3" onclick={open}
          >Erneut versuchen</ActionButton
        >
      </div>
    </div>
  {:else if phase === 'saveFailed'}
    <p class="mb-4 border-l-4 border-warning py-2 pl-4 text-sm text-neutral-800">
      <strong class="text-warning">Nicht als gelesen gespeichert.</strong>
      Die Zahl am Menü bleibt deshalb stehen. Prüfe deine Internetverbindung und lade die Seite neu. Hilft
      das nicht, schreib an
      <a href="mailto:{HELP_CONTACTS.technik}" class="font-semibold text-link"
        >{HELP_CONTACTS.technik}</a
      >.
    </p>
  {:else if newIds.length > 0}
    <p class="mb-4 text-sm text-neutral-700">
      {newIds.length === 1 ? 'Eine Neuigkeit' : `${newIds.length} Neuigkeiten`} für dich. Sie gelten jetzt
      als gelesen, auf allen deinen Geräten.
    </p>
  {:else}
    <p class="mb-4 text-sm text-neutral-700">Du bist auf dem neuesten Stand.</p>
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
          {#each entry.changes as change (change)}
            <li>{change}</li>
          {/each}
        </ul>
      </article>
    </li>
  {/each}
</ol>
