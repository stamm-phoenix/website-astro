<script lang="ts">
  import NewsTypeBadge from './NewsTypeBadge.svelte';
  import { formatBlogDate, getBlogPostUrl } from '../lib/blog';
  import type { BlogPostSummary } from '../lib/types';

  interface Props {
    post: BlogPostSummary;
    /** Heading level of the title within the page. */
    headingLevel?: 2 | 3;
    /** Aspect ratio of the cover, e.g. to match the Instagram cards in „Neues aus dem Stamm“ */
    imageClass?: string;
    /** Marks the card as blog post, where it is shown among Instagram posts */
    showType?: boolean;
    class?: string;
  }

  let {
    post,
    headingLevel = 3,
    imageClass = 'aspect-[16/10]',
    showType = false,
    class: className = '',
  }: Props = $props();
</script>

<article
  class="surface group relative flex h-full flex-col overflow-hidden transition duration-150 hover:-translate-y-0.5 hover:shadow-lift {className}"
>
  <div class="relative">
    {#if post.cover}
      <img
        src={post.cover.url}
        alt=""
        aria-hidden="true"
        width={post.cover.width}
        height={post.cover.height}
        loading="lazy"
        decoding="async"
        class="{imageClass} w-full object-cover"
      />
    {:else}
      <!-- .grid-overlay is positioned absolutely, so the area gets its size from this wrapper -->
      <div
        aria-hidden="true"
        class="relative {imageClass} w-full overflow-hidden bg-[var(--color-brand-50)]"
      >
        <div class="grid-overlay"></div>
      </div>
    {/if}
    {#if showType}
      <NewsTypeBadge type="blog" />
    {/if}
  </div>
  <div class="flex flex-1 flex-col gap-3 p-5">
    <p class="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
      <time datetime={post.date} class="font-semibold text-brand-900">
        {formatBlogDate(post.date)}
      </time>
      <span aria-hidden="true">•</span>
      <span>{post.readingMinutes} min Lesezeit</span>
    </p>
    <svelte:element this={`h${headingLevel}`} class="text-lg font-semibold text-brand-900">
      <!-- The link covers the whole card -->
      <a href={getBlogPostUrl(post.id)} class="no-underline after:absolute after:inset-0">
        {post.title}
      </a>
    </svelte:element>
    <p class="text-sm text-neutral-700">{post.excerpt}</p>
    <span
      aria-hidden="true"
      class="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-brand-800 group-hover:text-brand-900"
    >
      Beitrag lesen <span>→</span>
    </span>
  </div>
</article>
