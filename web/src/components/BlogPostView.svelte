<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, fetchApi } from '../lib/api';
  import { formatBlogDate, sanitizeBlogContent } from '../lib/blog';
  import type { BlogPost } from '../lib/types';

  let post = $state<BlogPost | null>(null);
  let error = $state<'not-found' | 'failed' | null>(null);

  const content = $derived(post ? sanitizeBlogContent(post.content) : '');
  /** The cover is shown above the text unless the text already contains it. */
  const showCover = $derived(
    post?.cover !== undefined && !content.includes(post.cover.url.split('?')[0])
  );

  onMount(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id || !/^\d+$/.test(id)) {
      error = 'not-found';
      return;
    }
    fetchApi<BlogPost>(`/blog/${id}`)
      .then((result) => {
        post = result;
        document.title = `${result.title} | Blog | Stamm Phoenix`;
      })
      .catch((reason: unknown) => {
        error = reason instanceof ApiError && reason.status === 404 ? 'not-found' : 'failed';
      });
  });
</script>

{#if error}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h1 class="font-serif text-2xl font-semibold text-brand-900">
      {error === 'not-found' ? 'Beitrag nicht gefunden' : 'Beitrag konnte nicht geladen werden'}
    </h1>
    <p class="mt-2 text-neutral-700">
      {error === 'not-found'
        ? 'Diesen Beitrag gibt es nicht (mehr).'
        : 'Bitte versuche es später noch einmal.'}
    </p>
    <a href="/blog" class="mt-4 inline-block font-semibold text-brand-800">Alle Beiträge</a>
  </div>
{:else if !post}
  <div role="status" aria-live="polite" class="mx-auto max-w-3xl space-y-4">
    <span class="sr-only">Beitrag wird geladen …</span>
    <div class="skeleton-element h-4 w-32 rounded-full"></div>
    <div class="skeleton-element h-10 w-3/4 rounded-full"></div>
    <div class="skeleton-element aspect-[16/9] w-full rounded-[var(--radius-lg)]"></div>
    <div class="skeleton-element h-4 w-full rounded-full"></div>
    <div class="skeleton-element h-4 w-5/6 rounded-full"></div>
  </div>
{:else}
  <article class="mx-auto max-w-3xl" aria-labelledby="blog-post-title">
    <header class="space-y-4">
      <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
        <time datetime={post.date} class="font-semibold text-brand-900">
          {formatBlogDate(post.date)}
        </time>
        <span aria-hidden="true">•</span>
        <span>{post.readingMinutes} min Lesezeit</span>
      </p>
      <h1
        id="blog-post-title"
        class="underline-accent mb-8 font-serif text-3xl font-semibold text-brand-900 md:text-4xl"
      >
        {post.title}
      </h1>
    </header>

    {#if showCover && post.cover}
      <img
        src={post.cover.url}
        alt={post.cover.alt}
        width={post.cover.width}
        height={post.cover.height}
        decoding="async"
        class="mt-8 w-full rounded-[var(--radius-lg)] object-cover"
      />
    {/if}

    <div class="blog-content mt-8 text-lg leading-relaxed text-neutral-800">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via sanitizeBlogContent -->
      {@html content}
    </div>

    <footer class="mt-12 border-t border-neutral-200 pt-6">
      <a href="/blog" class="font-semibold text-brand-800">
        <span aria-hidden="true">←</span> Alle Beiträge
      </a>
    </footer>
  </article>
{/if}

<style>
  .blog-content :global(p) {
    margin: 0 0 1.25rem;
  }
  .blog-content :global(h2) {
    margin: 2.5rem 0 1rem;
    font-family: var(--font-serif);
    font-size: 1.625rem;
    font-weight: 600;
    line-height: 1.25;
    color: var(--color-brand-900);
  }
  .blog-content :global(h3) {
    margin: 2rem 0 0.75rem;
    font-family: var(--font-serif);
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .blog-content :global(a) {
    color: var(--color-brand-800);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .blog-content :global(ul) {
    list-style: disc;
    padding-left: 1.5rem;
    margin: 0 0 1.25rem;
  }
  .blog-content :global(ol) {
    list-style: decimal;
    padding-left: 1.5rem;
    margin: 0 0 1.25rem;
  }
  .blog-content :global(li) {
    margin-bottom: 0.25rem;
  }
  .blog-content :global(img) {
    display: block;
    width: 100%;
    height: auto;
    margin: 2rem 0;
    border-radius: var(--radius-lg);
  }
</style>
