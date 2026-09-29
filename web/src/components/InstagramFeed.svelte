<script lang="ts">
  import { untrack } from 'svelte';
  import InstagramPostImages from './InstagramPostImages.svelte';
  import {
    instagramStore,
    fetchInstagram,
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
    {#each posts as post, index (post.id)}
      {@const date = formatPostDate(post.timestamp)}
      <li
        class="post surface group relative flex h-full flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
      >
        <InstagramPostImages
          {post}
          alt={post.caption ? '' : `Instagram-Beitrag vom ${date}`}
          autoAdvanceOffset={index * 900}
        />
        <!-- Covers the whole tile; the carousel buttons lie above it -->
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          class="post-link flex flex-1 flex-col gap-1 p-3 after:absolute after:inset-0 md:p-4"
        >
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
          {:else}
            <span class="sr-only">Instagram-Beitrag</span>
          {/if}
          <span class="sr-only">(öffnet Instagram in neuem Tab)</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .post:has(.post-link:focus-visible) {
    outline: 2px solid var(--color-dpsg-red);
    outline-offset: 3px;
  }

  .post-link:focus-visible {
    outline: none;
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
