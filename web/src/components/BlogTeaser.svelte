<script lang="ts">
  import { untrack } from 'svelte';
  import { blogStore, fetchBlogPosts } from '../lib/blogStore.svelte';
  import BlogPostCard from './BlogPostCard.svelte';

  const MAX_POSTS = 6;
  const posts = $derived(blogStore.data?.slice(0, MAX_POSTS) ?? []);

  $effect(() => {
    untrack(() => fetchBlogPosts());
  });
</script>

<!-- Hidden entirely while there are no posts or the blog cannot be loaded -->
{#if blogStore.loading || posts.length > 0}
  <section class="mt-16" aria-labelledby="blog-teaser-heading">
    <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div class="space-y-2">
        <p class="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-700)]">
          Stammblog
        </p>
        <h2
          id="blog-teaser-heading"
          class="underline-accent mb-8 font-serif text-2xl font-semibold text-brand-900 md:text-3xl"
        >
          Neues aus dem Stamm
        </h2>
        <p class="max-w-2xl text-neutral-700">
          Kleine Momente, große Abenteuer: Einblicke in Lager, Aktionen und Gruppenstunden.
        </p>
      </div>
      <a
        href="/blog"
        class="inline-flex w-fit items-center gap-2 rounded-sm border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-900 transition hover:border-brand-900 hover:text-brand-900"
      >
        Zum Blog <span aria-hidden="true">→</span>
      </a>
    </div>

    {#if blogStore.loading}
      <div role="status" aria-live="polite" class="mt-8 flex gap-6 overflow-hidden pb-4">
        <span class="sr-only">Beiträge werden geladen …</span>
        {#each [1, 2, 3] as n (n)}
          <div
            class="skeleton-element h-80 w-[280px] shrink-0 rounded-[var(--radius-lg)] sm:w-[320px]"
          ></div>
        {/each}
      </div>
    {:else}
      <ul
        class="mt-8 flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth px-1 pb-4"
        aria-label="Neueste Blogbeiträge"
      >
        {#each posts as post (post.id)}
          <li class="w-[280px] shrink-0 snap-start sm:w-[320px]">
            <BlogPostCard {post} />
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
