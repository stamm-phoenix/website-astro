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
    /** Opens the post in a dialog instead of the post page (the link stays as fallback) */
    onopen?: () => void;
    class?: string;
  }

  let {
    post,
    headingLevel = 3,
    imageClass = 'aspect-[16/10]',
    showType = false,
    onopen,
    class: className = '',
  }: Props = $props();
</script>

<article
  class="surface group relative flex h-full flex-col overflow-hidden {className}"
  class:text-only={!post.cover}
>
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
  {/if}
  <div class="flex flex-1 flex-col gap-3 p-5">
    <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
      {#if showType}
        <NewsTypeBadge type="blog" />
        <span aria-hidden="true">·</span>
      {/if}
      <time datetime={post.date} class="font-semibold text-brand-900">
        {formatBlogDate(post.date)}
      </time>
      <span aria-hidden="true">·</span>
      <span>{post.readingMinutes} min Lesezeit</span>
    </p>
    <svelte:element
      this={`h${headingLevel}`}
      class="font-semibold text-brand-900 {post.cover ? 'text-lg' : 'font-serif text-xl'}"
    >
      <!-- The link covers the whole card -->
      <a
        href={getBlogPostUrl(post.id)}
        class="no-underline after:absolute after:inset-0 group-hover:underline"
        aria-haspopup={onopen ? 'dialog' : undefined}
        onclick={(event) => {
          if (!onopen) return;
          event.preventDefault();
          onopen();
        }}
      >
        {post.title}
      </a>
    </svelte:element>
    <!-- Without a cover, the card shows more of the text instead (longer excerpt from the API) -->
    <p class="excerpt text-sm text-neutral-900" class:excerpt-long={!post.cover}>{post.excerpt}</p>
    <span
      aria-hidden="true"
      class="mt-auto text-sm font-semibold text-brand-900 underline decoration-neutral-300 underline-offset-4 group-hover:decoration-current"
    >
      {onopen ? 'Weiterlesen' : 'Beitrag lesen'}
    </span>
  </div>
</article>

<style>
  /* A card without a cover gets an accent line instead of the image area */
  .text-only {
    border-top: 4px solid var(--color-brand-900);
  }

  .excerpt {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
  }

  .excerpt-long {
    -webkit-line-clamp: 12;
    line-clamp: 12;
  }
</style>
