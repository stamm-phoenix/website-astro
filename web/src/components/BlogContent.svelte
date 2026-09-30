<script lang="ts">
  import { sanitizeBlogContent } from '../lib/blog';

  interface Props {
    /** HTML of a published post as delivered by the API */
    html: string;
    class?: string;
  }
  let { html, class: className = '' }: Props = $props();

  const content = $derived(sanitizeBlogContent(html));
</script>

<!-- Text of a blog post; used on the post page and in the post dialog -->
<div class="blog-content {className}">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via sanitizeBlogContent -->
  {@html content}
</div>

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
