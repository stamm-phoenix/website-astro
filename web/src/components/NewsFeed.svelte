<script lang="ts">
  import { untrack } from 'svelte';
  import InstagramProfileButton from './InstagramProfileButton.svelte';
  import NewsGrid from './NewsGrid.svelte';
  import { blogStore, fetchBlogPosts } from '../lib/blogStore.svelte';
  import {
    instagramStore,
    fetchInstagram,
    INSTAGRAM_PROFILE_URL,
  } from '../lib/instagramStore.svelte';
  import { mergeNews } from '../lib/newsFeed';

  const MAX_ITEMS = 6;

  // Waits for both sources, so the grid does not reorder once the slower one arrives
  const loading = $derived(blogStore.loading || instagramStore.loading);
  const items = $derived(
    mergeNews(blogStore.data ?? [], instagramStore.data ?? []).slice(0, MAX_ITEMS)
  );

  $effect(() => {
    untrack(() => {
      fetchBlogPosts();
      fetchInstagram();
    });
  });
</script>

<section class="mt-16" aria-labelledby="news-heading">
  <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div class="space-y-2">
      <h2
        id="news-heading"
        class="underline-accent mb-8 font-serif text-2xl font-semibold text-brand-900 md:text-3xl"
      >
        Neues aus dem Stamm
      </h2>
      <p class="max-w-2xl text-neutral-700">
        Kleine Momente, große Abenteuer: Berichte aus unserem Blog und Einblicke von Instagram.
      </p>
    </div>
    <div class="flex flex-wrap gap-3">
      <a
        href="/blog"
        class="inline-flex w-fit items-center gap-2 rounded-sm border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-900 transition hover:border-brand-900 hover:text-brand-900"
      >
        Zum Blog <span aria-hidden="true">→</span>
      </a>
      <InstagramProfileButton />
    </div>
  </div>

  {#if loading}
    <div role="status" aria-live="polite" class="mt-8">
      <span class="sr-only">Beiträge werden geladen …</span>
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {#each Array.from({ length: MAX_ITEMS }, (_, i) => i) as i (i)}
          <div class="skeleton-card surface overflow-hidden">
            <div class="skeleton-element aspect-[4/3] w-full"></div>
            <div class="space-y-3 p-5">
              <div class="skeleton-element h-3 w-1/3 rounded"></div>
              <div class="skeleton-element h-4 w-full rounded"></div>
              <div class="skeleton-element h-4 w-2/3 rounded"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if items.length === 0}
    <p class="surface mt-8 p-6 text-neutral-700">
      Unsere aktuellen Beiträge findest du auch auf
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
    <div class="mt-8">
      <NewsGrid {items} label="Neueste Beiträge aus Blog und Instagram" />
    </div>
  {/if}
</section>
