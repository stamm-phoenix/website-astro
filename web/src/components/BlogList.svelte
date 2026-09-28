<script lang="ts">
  import { untrack } from 'svelte';
  import { blogStore, fetchBlogPosts } from '../lib/blogStore.svelte';
  import { formatBlogDate, getBlogPostUrl } from '../lib/blog';
  import BlogPostCard from './BlogPostCard.svelte';

  const featured = $derived(blogStore.data?.[0]);
  const rest = $derived(blogStore.data?.slice(1) ?? []);

  $effect(() => {
    untrack(() => fetchBlogPosts());
  });
</script>

{#if blogStore.loading}
  <div role="status" aria-live="polite" class="mt-12 space-y-6">
    <span class="sr-only">Beiträge werden geladen …</span>
    <div class="skeleton-element h-72 rounded-[var(--radius-lg)]"></div>
    <div class="grid gap-6 md:grid-cols-2">
      <div class="skeleton-element h-64 rounded-[var(--radius-lg)]"></div>
      <div class="skeleton-element h-64 rounded-[var(--radius-lg)]"></div>
    </div>
  </div>
{:else if blogStore.error}
  <div role="alert" class="surface mt-12 p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <p class="text-neutral-700">
      Die Beiträge konnten gerade nicht geladen werden. Bitte versuche es später noch einmal.
    </p>
  </div>
{:else if !featured}
  <p class="surface mt-12 p-6 text-neutral-700">
    Hier erscheinen bald Berichte von unseren Aktionen und Lagern.
  </p>
{:else}
  <section class="mt-12" aria-labelledby="blog-featured">
    <h2 id="blog-featured" class="sr-only">Neuester Beitrag</h2>
    <article
      class="surface group relative grid overflow-hidden transition duration-150 hover:-translate-y-0.5 hover:shadow-lift lg:grid-cols-[7fr_5fr]"
    >
      {#if featured.cover}
        <img
          src={featured.cover.url}
          alt={featured.cover.alt}
          width={featured.cover.width}
          height={featured.cover.height}
          decoding="async"
          class="aspect-[16/10] h-full w-full object-cover"
        />
      {:else}
        <div
          aria-hidden="true"
          class="grid-overlay aspect-[16/10] h-full w-full bg-[var(--color-brand-50)]"
        ></div>
      {/if}
      <div class="flex flex-col gap-4 p-6 lg:p-8">
        <p class="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-dpsg-red)]">
          Neuester Beitrag
        </p>
        <h3 class="font-serif text-2xl font-semibold text-brand-900 md:text-3xl">
          <a href={getBlogPostUrl(featured.id)} class="no-underline after:absolute after:inset-0">
            {featured.title}
          </a>
        </h3>
        <p class="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
          <time datetime={featured.date} class="font-semibold text-brand-900">
            {formatBlogDate(featured.date)}
          </time>
          <span aria-hidden="true">•</span>
          <span>{featured.readingMinutes} min Lesezeit</span>
        </p>
        <p class="text-neutral-700">{featured.excerpt}</p>
        <span
          aria-hidden="true"
          class="mt-auto inline-flex w-fit items-center gap-2 rounded-sm border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-900 group-hover:border-brand-900 group-hover:text-brand-900"
        >
          Beitrag lesen <span>→</span>
        </span>
      </div>
    </article>
  </section>

  {#if rest.length > 0}
    <section class="mt-16" aria-labelledby="blog-all">
      <h2
        id="blog-all"
        class="underline-accent mb-8 font-serif text-2xl font-semibold text-brand-900 md:text-3xl"
      >
        Weitere Beiträge
      </h2>
      <ul class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {#each rest as post (post.id)}
          <li><BlogPostCard {post} /></li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}
