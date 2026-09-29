<script lang="ts">
  import BlogContent from './BlogContent.svelte';
  import InstagramPostImages from './InstagramPostImages.svelte';
  import NewsTypeBadge from './NewsTypeBadge.svelte';
  import { fetchApi } from '../lib/api';
  import { formatBlogDate, getBlogPostUrl } from '../lib/blog';
  import {
    shouldConfirmInstagram,
    type InstagramConsentRequest,
  } from '../lib/instagramStore.svelte';
  import type { NewsItem } from '../lib/newsFeed';
  import type { BlogPost } from '../lib/types';

  interface Props {
    /** The post shown in the dialog; the dialog is open while set */
    item: NewsItem | null;
    onclose: () => void;
    /** Asks the visitor before leaving for Instagram or loading a video from there */
    onconsent: (request: InstagramConsentRequest) => void;
  }
  let { item, onclose, onconsent }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  // Full blog posts, loaded when a post is opened for the first time
  let blogPosts = $state<Record<string, BlogPost | 'failed'>>({});

  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  function formatInstagramDate(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
  }

  $effect(() => {
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  });

  // The page behind the dialog does not scroll along
  $effect(() => {
    if (!item) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  });

  $effect(() => {
    if (item?.type !== 'blog') return;
    const id = item.post.id;
    if (blogPosts[id] && blogPosts[id] !== 'failed') return;
    fetchApi<BlogPost>(`/blog/${encodeURIComponent(id)}`)
      .then((post) => {
        blogPosts = { ...blogPosts, [id]: post };
      })
      .catch(() => {
        blogPosts = { ...blogPosts, [id]: 'failed' };
      });
  });

  /** Instagram posts wider than this are shown with the text below instead of beside */
  const WIDE_RATIO = 1.2;
  let instagramRatio = $state(4 / 5);

  $effect(() => {
    // Every post starts with the usual portrait shape until its image has loaded
    if (item?.type === 'instagram') instagramRatio = 4 / 5;
  });

  function openOnInstagram(event: MouseEvent, href: string): void {
    if (!shouldConfirmInstagram('link')) return;
    event.preventDefault();
    onconsent({ kind: 'link', href });
  }

  /** The cover is shown above the text unless the text already contains it. */
  function showCover(
    summary: { cover?: { url: string } },
    full: BlogPost | 'failed' | undefined
  ): boolean {
    if (!summary.cover) return false;
    if (!full || full === 'failed') return true;
    return !full.content.includes(summary.cover.url.split('?')[0]);
  }
</script>

<!-- Shows a post of „Neues aus dem Stamm“ large and complete without leaving the page -->
<dialog
  bind:this={dialog}
  aria-labelledby="news-modal-title"
  class="news-modal m-auto overflow-hidden rounded-[var(--radius-lg)] border border-neutral-200 bg-white p-0 shadow-lift"
  oncancel={(event) => {
    // Esc: close via our state, so content, scroll lock and dialog stay in sync
    event.preventDefault();
    onclose();
  }}
  onclose={() => {
    if (item) onclose();
  }}
  onclick={(event) => {
    // A click on the backdrop (outside the content) closes the dialog
    if (event.target === dialog) onclose();
  }}
>
  {#if item}
    <button
      type="button"
      class="close-button absolute top-3 right-3 z-20 flex size-10 items-center justify-center rounded-full"
      aria-label="Schließen"
      onclick={onclose}
    >
      <svg
        aria-hidden="true"
        class="size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>

    {#if item.type === 'instagram'}
      {@const post = item.post}
      {@const date = formatInstagramDate(post.timestamp)}
      <!-- Portrait and square beside the text; wide images above it, so there are no bars -->
      <div
        class="modal-layout instagram-layout"
        class:side-by-side={instagramRatio <= WIDE_RATIO}
        style:--ratio={instagramRatio}
      >
        <div class="media-column bg-neutral-900">
          <InstagramPostImages
            {post}
            variant="modal"
            alt={post.caption ? '' : `Instagram-Beitrag vom ${date}`}
            {onconsent}
            bind:ratio={instagramRatio}
          />
        </div>
        <div class="text-column space-y-4 p-6">
          <NewsTypeBadge type="instagram" inline />
          {#if date}
            <p class="text-sm font-semibold text-brand-900">
              <time datetime={post.timestamp}>{date}</time>
            </p>
          {/if}
          <h2 id="news-modal-title" class="sr-only">Instagram-Beitrag vom {date}</h2>
          {#if post.caption}
            <p class="caption text-neutral-800">{post.caption}</p>
          {/if}
          <div class="pt-2">
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              class="btn-primary"
              onclick={(event) => openOnInstagram(event, post.permalink)}
            >
              Auf Instagram ansehen <span aria-hidden="true">↗</span>
              <span class="sr-only">(öffnet in neuem Tab)</span>
            </a>
          </div>
        </div>
      </div>
    {:else}
      {@const summary = item.post}
      {@const full = blogPosts[summary.id]}
      <!-- Like the post page: one readable column, images in full column width -->
      <article class="modal-layout blog-article space-y-4">
        <NewsTypeBadge type="blog" inline />
        <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
          <time datetime={summary.date} class="font-semibold text-brand-900">
            {formatBlogDate(summary.date)}
          </time>
          <span aria-hidden="true">•</span>
          <span>{summary.readingMinutes} min Lesezeit</span>
        </p>
        <h2
          id="news-modal-title"
          class="pr-10 font-serif text-2xl font-semibold text-brand-900 md:text-3xl"
        >
          {summary.title}
        </h2>
        {#if summary.cover && showCover(summary, full)}
          <img
            src={summary.cover.url}
            alt={summary.cover.alt}
            width={summary.cover.width}
            height={summary.cover.height}
            decoding="async"
            class="w-full rounded-[var(--radius-lg)]"
          />
        {/if}
        {#if full === 'failed'}
          <p role="alert" class="text-neutral-700">
            Der Beitrag konnte gerade nicht geladen werden. Auf der Beitragsseite findest du ihn
            vollständig.
          </p>
        {:else if full}
          <BlogContent html={full.content} class="text-lg leading-relaxed text-neutral-800" />
        {:else}
          <div role="status" aria-live="polite" class="space-y-3">
            <span class="sr-only">Beitrag wird geladen …</span>
            <div class="skeleton-element h-4 w-full rounded-full"></div>
            <div class="skeleton-element h-4 w-5/6 rounded-full"></div>
            <div class="skeleton-element h-4 w-4/6 rounded-full"></div>
          </div>
        {/if}
        <div class="pt-2">
          <a href={getBlogPostUrl(summary.id)} class="btn-primary">
            Zum Beitrag <span aria-hidden="true">→</span>
          </a>
        </div>
      </article>
    {/if}
  {/if}
</dialog>

<style>
  .news-modal {
    max-width: min(72rem, calc(100vw - 2rem));
    max-height: 92dvh;
  }

  .news-modal::backdrop {
    background: rgb(0 0 0 / 0.6);
  }

  .close-button {
    background: rgb(255 255 255 / 0.9);
    color: var(--color-brand-900);
    box-shadow: var(--shadow-soft);
  }

  .close-button:focus-visible {
    outline: 2px solid var(--color-dpsg-red);
    outline-offset: 2px;
  }

  /* Default (phones, and wide images everywhere): media on top, text below, all scrolls */
  .modal-layout {
    --media-max-width: min(56rem, calc(100vw - 2rem));
    --media-max-height: 65dvh;
    display: flex;
    flex-direction: column;
    max-height: 92dvh;
    overflow-y: auto;
  }

  .media-column {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
  }

  .caption {
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  /* With the text below, the dialog is exactly as wide as the image (no bars beside it) */
  .instagram-layout {
    width: min(var(--media-max-width), calc(var(--media-max-height) * var(--ratio)));
  }

  .blog-article {
    width: min(48rem, calc(100vw - 2rem));
    padding: 1.5rem;
  }

  @media (min-width: 1024px) {
    /* Portrait and square: media left in its natural shape, text right with its own scrollbar */
    .modal-layout.side-by-side {
      --media-max-width: calc(min(72rem, 100vw - 2rem) - 24rem);
      --media-max-height: 88dvh;
      width: auto;
      flex-direction: row;
      overflow: hidden;
    }

    .side-by-side .text-column {
      width: 24rem;
      max-height: 92dvh;
      overflow-y: auto;
    }

    .blog-article {
      padding: 2.5rem;
    }
  }
</style>
