<script lang="ts">
  import { untrack } from 'svelte';
  import {
    instagramStore,
    fetchInstagram,
    getInstagramImageUrl,
    INSTAGRAM_PROFILE_URL,
  } from '../lib/instagramStore.svelte';

  const POST_COUNT = 6;

  const posts = $derived((instagramStore.data ?? []).slice(0, POST_COUNT));

  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  $effect(() => {
    untrack(() => {
      fetchInstagram();
    });
  });

  function formatPostDate(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
  }
</script>

{#if instagramStore.loading}
  <div role="status" aria-live="polite" class="sr-only">Instagram-Beiträge werden geladen...</div>
  <ul class="grid grid-cols-2 gap-4 lg:grid-cols-3 lg:gap-6" aria-hidden="true">
    {#each Array.from({ length: POST_COUNT }, (_, i) => i) as i (i)}
      <li class="skeleton-card surface overflow-hidden">
        <div class="skeleton-element aspect-square w-full"></div>
        <div class="space-y-2 p-3 md:p-4">
          <div class="skeleton-element h-3 w-1/3 rounded"></div>
          <div class="skeleton-element h-4 w-full rounded"></div>
          <div class="skeleton-element h-4 w-2/3 rounded"></div>
        </div>
      </li>
    {/each}
  </ul>
{:else if instagramStore.error || posts.length === 0}
  <p class="surface p-6 text-neutral-700">
    Unsere aktuellen Beiträge findest du direkt auf
    <a
      href={INSTAGRAM_PROFILE_URL}
      target="_blank"
      rel="noopener noreferrer"
      class="font-semibold text-brand-800 underline hover:text-brand-900"
    >
      Instagram<span class="sr-only"> (öffnet in neuem Tab)</span>
    </a>.
  </p>
{:else}
  <ul class="grid grid-cols-2 gap-4 lg:grid-cols-3 lg:gap-6">
    {#each posts as post (post.id)}
      {@const date = formatPostDate(post.timestamp)}
      <li>
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          class="post surface group flex h-full flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
        >
          <div class="relative aspect-square overflow-hidden bg-neutral-100">
            <img
              src={getInstagramImageUrl(post.id)}
              alt={post.caption ? '' : `Instagram-Beitrag vom ${date}`}
              width="640"
              height="640"
              loading="lazy"
              decoding="async"
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {#if post.mediaType !== 'IMAGE'}
              <span
                class="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-brand-900/80 text-white"
                aria-hidden="true"
              >
                {#if post.mediaType === 'VIDEO'}
                  <svg class="size-4" viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"
                    />
                  </svg>
                {:else}
                  <svg
                    class="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linejoin="round"
                  >
                    <rect x="8" y="8" width="13" height="13" rx="2" />
                    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                  </svg>
                {/if}
              </span>
            {/if}
          </div>
          <div class="flex flex-1 flex-col gap-1 p-3 md:p-4">
            {#if date}
              <time
                datetime={post.timestamp}
                class="text-xs font-semibold uppercase tracking-wide text-[var(--color-dpsg-red)]"
              >
                {date}
              </time>
            {/if}
            {#if post.caption}
              <p class="caption text-sm text-neutral-800">{post.caption}</p>
            {/if}
          </div>
          <span class="sr-only">(öffnet Instagram in neuem Tab)</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .post:focus-visible {
    outline: 2px solid var(--color-dpsg-red);
    outline-offset: 3px;
  }

  .caption {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  @media (min-width: 768px) {
    .caption {
      -webkit-line-clamp: 3;
      line-clamp: 3;
    }
  }
</style>
