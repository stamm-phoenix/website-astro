<script lang="ts">
  import { onMount } from 'svelte';
  import BlogPostView from './BlogPostView.svelte';

  /**
   * A post from `?id=` without a page of its own: posts published after the last build, and
   * all posts of PR previews, whose build only knows the test data. The 404 page sends them
   * here with `live=1`. Without it (old links to this page) the visitor goes on to
   * /blog/<id>/, which comes back here with `live=1` if the page does not exist.
   */
  let id = $state<string | null>(null);
  let invalid = $state(false);

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('id') ?? '';
    if (!/^\d{1,9}$/.test(value)) {
      invalid = true;
      return;
    }
    if (params.get('live') === '1') id = value;
    else window.location.replace(`/blog/${value}/`);
  });
</script>

{#if invalid}
  <section class="surface mx-auto max-w-3xl p-6" aria-labelledby="blog-live-heading">
    <h1 id="blog-live-heading" class="font-serif text-2xl font-semibold text-brand-900">
      Beitrag nicht gefunden
    </h1>
    <p class="mt-2 text-neutral-700">
      Alle Beiträge findest du in der
      <a href="/blog" class="font-semibold text-link">Blog-Übersicht</a>.
    </p>
  </section>
{:else if id}
  <BlogPostView {id} />
{:else}
  <div role="status" aria-live="polite" class="mx-auto max-w-3xl">
    <span class="sr-only">Beitrag wird geladen …</span>
  </div>
{/if}
