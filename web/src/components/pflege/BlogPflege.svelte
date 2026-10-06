<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { untrack } from 'svelte';
  import { blogPflege } from '../../lib/pflegeStore.svelte';
  import { formatBlogDate, getBlogPostUrl, getStaffBlogImageUrl } from '../../lib/blog';

  const EDITOR_URL = '/leitendenbereich/blog/beitrag';
  const store = blogPflege.state;

  let search = $state('');

  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return (store.data ?? []).filter((post) => !query || post.title.toLowerCase().includes(query));
  });

  $effect(() => {
    untrack(() => blogPflege.load({ force: true }));
  });
</script>

<div class="space-y-6">
  <form
    class="grid gap-4 border-b border-neutral-200 pb-5 sm:grid-cols-[1fr_auto] sm:items-end"
    role="search"
    aria-label="Beiträge durchsuchen"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm">
      <span class="form-label">Suche</span>
      <input type="search" class="form-input" placeholder="Titel …" bind:value={search} />
    </label>
    <div class="flex gap-2">
      <ActionButton
        variant="secondary"
        type="button"
        disabled={store.loading}
        onclick={() => blogPflege.load({ force: true })}
      >
        Neu laden
      </ActionButton>
      <a href={EDITOR_URL} class="btn-primary">Neuer Beitrag</a>
    </div>
  </form>

  {#if !store.data && store.loading}
    <div role="status" aria-live="polite" class="space-y-3">
      <span class="sr-only">Beiträge werden geladen …</span>
      {#each [1, 2, 3] as n (n)}
        <div class="skeleton-element h-20 rounded-[var(--radius-lg)]"></div>
      {/each}
    </div>
  {:else if !store.data}
    <div role="alert" class="border-l-2 border-danger py-1 pl-4">
      <p class="text-sm text-neutral-700">{store.error}</p>
      <ActionButton
        variant="primary"
        type="button"
        class="mt-4"
        onclick={() => blogPflege.load({ force: true })}
      >
        Erneut versuchen
      </ActionButton>
    </div>
  {:else if visible.length === 0}
    <p class="py-4 text-sm text-neutral-700">
      {store.data.length === 0 ? 'Noch keine Beiträge.' : 'Keine Beiträge für diese Suche.'}
    </p>
  {:else}
    <ul class="divide-y divide-neutral-200 border-b border-neutral-200">
      {#each visible as post (post.id)}
        <li class="flex flex-wrap items-center gap-4 py-4 sm:flex-nowrap">
          {#if post.cover}
            <img
              src={getStaffBlogImageUrl(post.id, post.cover)}
              alt=""
              aria-hidden="true"
              width="96"
              height="64"
              loading="lazy"
              class="h-16 w-24 shrink-0 rounded-sm object-cover"
            />
          {:else}
            <span
              aria-hidden="true"
              class="h-16 w-24 shrink-0 rounded-sm border border-dashed border-neutral-300"
            ></span>
          {/if}
          <div class="min-w-0 flex-1">
            <a
              href="{EDITOR_URL}?id={post.id}"
              class="block truncate font-semibold text-brand-900 hover:underline"
            >
              {post.title || 'Ohne Titel'}
            </a>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-700">
              <span
                class="inline-flex items-center gap-1.5 font-semibold {post.published
                  ? 'text-success'
                  : 'text-neutral-700'}"
              >
                <span
                  aria-hidden="true"
                  class="size-2 rounded-full {post.published
                    ? 'bg-success'
                    : 'border border-neutral-500'}"
                ></span>
                {post.published ? 'Veröffentlicht' : 'Entwurf'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatBlogDate(post.date)}</span>
              <span aria-hidden="true">·</span>
              <span>{post.imageCount} {post.imageCount === 1 ? 'Bild' : 'Bilder'}</span>
            </p>
          </div>
          <div class="flex gap-2">
            {#if post.published}
              <a href={getBlogPostUrl(post.id)} class="btn-secondary">
                Ansehen<span class="sr-only">: {post.title}</span>
              </a>
            {/if}
            <a href="{EDITOR_URL}?id={post.id}" class="btn-secondary">
              Bearbeiten<span class="sr-only">: {post.title}</span>
            </a>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
