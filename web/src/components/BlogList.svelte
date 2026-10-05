<script lang="ts">
  import { untrack } from 'svelte';
  import { blogStore, fetchBlogPosts } from '../lib/blogStore.svelte';
  import { instagramStore, fetchInstagram } from '../lib/instagramStore.svelte';
  import { formatBlogDate, getBlogPostUrl } from '../lib/blog';
  import { mergeNews } from '../lib/newsFeed';
  import NewsGrid from './NewsGrid.svelte';
  import { bakedUrl, registerBakedImages, type BakedImages } from '../lib/bakedImages';
  import { withBaked } from '../lib/storeView';
  import type { BlogPostSummary, InstagramPost } from '../lib/types';

  interface Props {
    /** Baked at build time; refreshed from the API in the browser */
    initialBlog?: BlogPostSummary[] | null;
    initialInstagram?: InstagramPost[] | null;
    images?: BakedImages;
  }
  let { initialBlog = null, initialInstagram = null, images = {} }: Props = $props();

  untrack(() => registerBakedImages(images));
  const blog = $derived(withBaked(blogStore, initialBlog));
  const instagram = $derived(withBaked(instagramStore, initialInstagram));

  // The newest blog post is shown large; the other posts and Instagram follow mixed by date
  const featured = $derived(blog.data?.[0]);
  const rest = $derived(mergeNews(blog.data?.slice(1) ?? [], instagram.data ?? []));
  const loading = $derived(blog.loading || instagram.loading);

  $effect(() => {
    untrack(() => {
      fetchBlogPosts();
      fetchInstagram();
    });
  });
</script>

{#if loading}
  <div role="status" aria-live="polite" class="mt-12 space-y-6">
    <span class="sr-only">Beiträge werden geladen …</span>
    <div class="skeleton-element h-72 rounded-[var(--radius-lg)]"></div>
    <div class="grid gap-6 md:grid-cols-2">
      <div class="skeleton-element h-64 rounded-[var(--radius-lg)]"></div>
      <div class="skeleton-element h-64 rounded-[var(--radius-lg)]"></div>
    </div>
  </div>
{:else if blog.error && rest.length === 0}
  <div role="alert" class="mt-12 border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5">
    <p class="text-neutral-700">
      Die Beiträge konnten gerade nicht geladen werden. Bitte versuche es später noch einmal.
    </p>
  </div>
{:else if !featured && rest.length === 0}
  <p class="mt-12 border-y border-neutral-200 py-6 text-neutral-700">
    Hier erscheinen bald Berichte von unseren Aktionen und Lagern.
  </p>
{:else}
  {#if featured}
    <section class="mt-12" aria-labelledby="blog-featured">
      <h2 id="blog-featured" class="sr-only">Neuester Beitrag</h2>
      <article
        class="surface group relative grid overflow-hidden {featured.cover
          ? 'lg:grid-cols-[7fr_5fr]'
          : ''}"
        class:featured-text-only={!featured.cover}
      >
        {#if featured.cover}
          <img
            src={bakedUrl(featured.cover.url)}
            alt={featured.cover.alt}
            width={featured.cover.width}
            height={featured.cover.height}
            decoding="async"
            class="aspect-[16/10] h-full w-full object-cover"
          />
        {/if}
        <!-- Without a cover, the text takes the whole width (longer excerpt from the API) -->
        <div class="flex flex-col gap-4 p-6 lg:p-8" class:max-w-3xl={!featured.cover}>
          <p class="text-sm font-semibold text-[var(--color-dpsg-red)]">Neuester Beitrag</p>
          <h3 class="font-serif text-2xl font-semibold text-brand-900 md:text-3xl">
            <a
              href={getBlogPostUrl(featured.id)}
              class="no-underline after:absolute after:inset-0 group-hover:underline"
            >
              {featured.title}
            </a>
          </h3>
          <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
            <time datetime={featured.date} class="font-semibold text-brand-900">
              {formatBlogDate(featured.date)}
            </time>
            <span aria-hidden="true">·</span>
            <span>{featured.readingMinutes} min Lesezeit</span>
          </p>
          <p class="text-neutral-900">{featured.excerpt}</p>
          <span
            aria-hidden="true"
            class="mt-auto font-semibold text-brand-900 underline decoration-neutral-300 underline-offset-4 group-hover:decoration-current"
          >
            Beitrag lesen
          </span>
        </div>
      </article>
    </section>
  {/if}

  {#if blog.error}
    <!-- Instagram loaded, the blog did not: show what is there, but say that posts are missing -->
    <p
      role="status"
      class="mt-12 border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5 text-neutral-700"
    >
      Die Blogbeiträge konnten gerade nicht geladen werden; hier siehst du vorerst nur die
      Instagram-Beiträge. Bitte versuche es später noch einmal.
    </p>
  {/if}

  {#if rest.length > 0}
    <section class="mt-16" aria-labelledby="blog-all">
      <h2
        id="blog-all"
        class="underline-accent mb-8 font-serif text-2xl font-semibold text-brand-900 md:text-3xl"
      >
        {featured ? 'Weitere Beiträge' : 'Beiträge'}
      </h2>
      <p class="mb-8 max-w-2xl text-neutral-700">
        Aus unserem Blog und von Instagram, das Neueste zuerst.
      </p>
      <NewsGrid items={rest} />
    </section>
  {/if}
{/if}

<style>
  /* Like the cards without cover: an accent line instead of an empty image area */
  .featured-text-only {
    border-top: 4px solid var(--color-brand-900);
  }
</style>
