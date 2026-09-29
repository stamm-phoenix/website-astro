<script lang="ts">
  import { sanitizeBlogContent } from '../lib/blog';
  import type { BlogContentImage } from '../lib/types';

  interface Props {
    /** HTML of a published post as delivered by the API */
    html: string;
    /** Makes the images clickable (mouse and keyboard); called with the chosen image */
    onimageselect?: (image: BlogContentImage) => void;
    /** `src` of the image currently shown large; it is marked in the text */
    selectedSrc?: string;
    class?: string;
  }
  let { html, onimageselect, selectedSrc, class: className = '' }: Props = $props();

  const content = $derived(sanitizeBlogContent(html));
  let container = $state<HTMLDivElement>();

  /** Identifies an image independently of the requested size (?w=…) */
  function imageKey(src: string): string {
    return src.split('?')[0];
  }

  function toImage(img: HTMLImageElement): BlogContentImage {
    return {
      src: img.getAttribute('src') ?? '',
      srcset: img.getAttribute('srcset') ?? '',
      alt: img.alt,
      width: img.naturalWidth || Number(img.getAttribute('width')) || 1,
      height: img.naturalHeight || Number(img.getAttribute('height')) || 1,
    };
  }

  // The images come from {@html}, so they are made operable here instead of in the markup
  $effect(() => {
    void content;
    const root = container;
    const select = onimageselect;
    if (!root || !select) return;
    for (const img of root.querySelectorAll('img')) {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', `Bild groß anzeigen${img.alt ? `: ${img.alt}` : ''}`);
      img.classList.add('selectable');
    }
    const target = (event: Event): HTMLImageElement | null =>
      event.target instanceof HTMLImageElement ? event.target : null;
    const onClick = (event: MouseEvent): void => {
      const img = target(event);
      if (img) select(toImage(img));
    };
    const onKey = (event: KeyboardEvent): void => {
      const img = target(event);
      if (img && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        select(toImage(img));
      }
    };
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
    };
  });

  // Marks the image that is currently shown large
  $effect(() => {
    void content;
    if (!container) return;
    const selected = selectedSrc ? imageKey(selectedSrc) : undefined;
    for (const img of container.querySelectorAll('img')) {
      const isSelected =
        selected !== undefined && imageKey(img.getAttribute('src') ?? '') === selected;
      img.classList.toggle('selected', isSelected);
      if (onimageselect) img.setAttribute('aria-pressed', String(isSelected));
    }
  });
</script>

<!-- Text of a blog post; used on the post page and in the post dialog -->
<div bind:this={container} class="blog-content {className}">
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

  /* Images that can be shown large beside the text */
  .blog-content :global(img.selectable) {
    cursor: zoom-in;
    transition:
      outline-color 0.15s ease,
      opacity 0.15s ease;
    outline: 3px solid transparent;
    outline-offset: 3px;
  }
  .blog-content :global(img.selectable:hover) {
    opacity: 0.9;
  }
  .blog-content :global(img.selectable:focus-visible) {
    outline-color: var(--color-dpsg-red);
  }
  .blog-content :global(img.selected) {
    outline-color: var(--color-brand-900);
    cursor: default;
  }
</style>
