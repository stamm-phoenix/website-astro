<script lang="ts">
  import InstagramPostImages from './InstagramPostImages.svelte';
  import NewsTypeBadge from './NewsTypeBadge.svelte';
  import {
    shouldConfirmInstagram,
    type InstagramConsentRequest,
  } from '../lib/instagramStore.svelte';
  import type { InstagramPost } from '../lib/types';

  interface Props {
    post: InstagramPost;
    /** Staggers the carousels of different cards */
    autoAdvanceOffset?: number;
    /** Asks the visitor first before opening the post or loading its video from Instagram */
    onconsent: (request: InstagramConsentRequest) => void;
  }
  let { post, autoAdvanceOffset = 0, onconsent }: Props = $props();

  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const date = $derived.by(() => {
    const parsed = new Date(post.timestamp);
    return Number.isNaN(parsed.getTime()) ? '' : dateFormatter.format(parsed);
  });

  function confirmLeave(event: MouseEvent): void {
    if (!shouldConfirmInstagram('link')) return;
    event.preventDefault();
    onconsent({ kind: 'link', href: post.permalink });
  }
</script>

<article
  class="post surface group relative flex h-full flex-col overflow-hidden transition duration-150 hover:-translate-y-0.5 hover:shadow-lift"
>
  <div class="relative">
    <InstagramPostImages
      {post}
      alt={post.caption ? '' : `Instagram-Beitrag vom ${date}`}
      aspectClass="aspect-[4/3]"
      {autoAdvanceOffset}
      {onconsent}
    />
    <NewsTypeBadge type="instagram" />
  </div>
  <!-- Covers the whole card; the carousel and play buttons lie above it -->
  <a
    href={post.permalink}
    target="_blank"
    rel="noopener noreferrer"
    class="post-link flex flex-1 flex-col gap-3 p-5 no-underline after:absolute after:inset-0"
    onclick={confirmLeave}
  >
    {#if date}
      <time datetime={post.timestamp} class="text-xs font-semibold text-brand-900">{date}</time>
    {/if}
    {#if post.caption}
      <p class="caption text-sm text-neutral-800">{post.caption}</p>
    {:else}
      <span class="sr-only">Instagram-Beitrag</span>
    {/if}
    <span
      aria-hidden="true"
      class="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-brand-800 group-hover:text-brand-900"
    >
      Auf Instagram ansehen <span>↗</span>
    </span>
    <span class="sr-only">(öffnet Instagram in neuem Tab)</span>
  </a>
</article>

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
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
</style>
