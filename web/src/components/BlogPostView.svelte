<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { ApiError, fetchApi } from '../lib/api';
  import { formatBlogDate } from '../lib/blog';
  import { bakedUrl, registerBakedImages, type BakedImages } from '../lib/bakedImages';
  import type { BlogPost } from '../lib/types';
  import BlogContent from './BlogContent.svelte';

  interface Props {
    id: string;
    /** Baked at build time; refreshed from the API in the browser */
    initial?: BlogPost | null;
    images?: BakedImages;
  }
  let { id, initial = null, images = {} }: Props = $props();

  untrack(() => registerBakedImages(images));
  let post = $state<BlogPost | null>(untrack(() => initial));
  let error = $state<'not-found' | 'failed' | null>(null);

  /** The cover is shown above the text unless the text already contains it. */
  const showCover = $derived(
    post?.cover !== undefined && !post.content.includes(post.cover.url.split('?')[0])
  );

  onMount(() => {
    fetchApi<BlogPost>(`/blog/${encodeURIComponent(id)}`)
      .then((result) => {
        post = result;
        document.title = `${result.title} | Blog | Stamm Phoenix`;
      })
      .catch((reason: unknown) => {
        // A withdrawn post disappears right away, even before the next build removes the page
        if (reason instanceof ApiError && reason.status === 404) {
          post = null;
          error = 'not-found';
        } else if (!post) {
          error = 'failed';
        }
      });
  });
</script>

{#if error}
  <div role="alert" class="mx-auto max-w-3xl border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5">
    <h1 class="font-serif text-2xl font-semibold text-brand-900">
      {error === 'not-found' ? 'Beitrag nicht gefunden' : 'Beitrag konnte nicht geladen werden'}
    </h1>
    <p class="mt-2 text-neutral-700">
      {error === 'not-found'
        ? 'Diesen Beitrag gibt es nicht (mehr).'
        : 'Bitte versuche es später noch einmal.'}
    </p>
    <a href="/blog" class="mt-4 inline-block font-semibold text-link underline underline-offset-4"
      >Alle Beiträge</a
    >
  </div>
{:else if !post}
  <div role="status" aria-live="polite" class="mx-auto max-w-3xl space-y-4">
    <span class="sr-only">Beitrag wird geladen …</span>
    <div class="skeleton-element h-4 w-32 rounded-sm"></div>
    <div class="skeleton-element h-10 w-3/4 rounded-sm"></div>
    <div class="skeleton-element aspect-[16/9] w-full rounded-[var(--radius-lg)]"></div>
    <div class="skeleton-element h-4 w-full rounded-sm"></div>
    <div class="skeleton-element h-4 w-5/6 rounded-sm"></div>
  </div>
{:else}
  <article class="mx-auto max-w-3xl" aria-labelledby="blog-post-title">
    <header class="space-y-4">
      <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
        <time datetime={post.date} class="font-semibold text-brand-900">
          {formatBlogDate(post.date)}
        </time>
        <span aria-hidden="true">·</span>
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
        src={bakedUrl(post.cover.url)}
        alt={post.cover.alt}
        width={post.cover.width}
        height={post.cover.height}
        decoding="async"
        class="mt-8 w-full rounded-[var(--radius-lg)] object-cover"
      />
    {/if}

    <BlogContent html={post.content} class="mt-8 text-lg leading-relaxed text-neutral-800" />

    <footer class="mt-12 border-t border-neutral-200 pt-6">
      <a href="/blog" class="font-semibold text-link">
        <span aria-hidden="true">←</span> Alle Beiträge
      </a>
    </footer>
  </article>
{/if}
