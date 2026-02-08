<script lang="ts">
  import { untrack } from "svelte";
  import { blogStore, fetchBlog } from "../lib/blogStore.svelte";
  import { sanitizeDescription, getBlogImageUrl } from "../lib/api";
  import type { BlogPost } from "../lib/types";

  interface Props {
    postId?: string;
  }
  let { postId: propPostId }: Props = $props();

  let postId = $state<string | null>(propPostId ?? null);

  $effect(() => {
    untrack(() => {
      if (!postId) {
        const params = new URLSearchParams(window.location.search);
        postId = params.get("post");
      }
      fetchBlog();
    });
  });

  $effect(() => {
    if (post) {
      document.title = `${post.title} | Blog | Stamm Phoenix`;
    }
  });

  const post = $derived(
    blogStore.data?.find((p: BlogPost) => p.id === postId) ?? null,
  );

  function formatDate(isoString: string): string {
    return new Date(isoString).toLocaleDateString("de-DE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
</script>

{#if blogStore.loading}
  <div role="status" aria-live="polite" class="sr-only">
    Blog-Beitrag wird geladen...
  </div>
  <div class="space-y-4">
    <div class="skeleton-element h-8 w-3/4 rounded"></div>
    <div class="skeleton-element h-4 w-48 rounded"></div>
    <div class="skeleton-element h-4 w-32 rounded"></div>
    <div class="skeleton-element h-48 w-full rounded-md mt-6"></div>
    <div class="space-y-2 mt-6">
      <div class="skeleton-element h-4 w-full rounded"></div>
      <div class="skeleton-element h-4 w-full rounded"></div>
      <div class="skeleton-element h-4 w-5/6 rounded"></div>
      <div class="skeleton-element h-4 w-full rounded"></div>
      <div class="skeleton-element h-4 w-3/4 rounded"></div>
    </div>
  </div>
{:else if blogStore.error}
  <article role="alert" class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)]" aria-labelledby="blog-error-heading">
    <div class="flex items-start gap-4">
      <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-dpsg-red)]/10 flex items-center justify-center">
        <svg
          aria-hidden="true"
          class="w-5 h-5 text-[var(--color-dpsg-red)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div>
        <h3 id="blog-error-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">
          Daten konnten nicht geladen werden
        </h3>
        <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
          Der Blog-Beitrag konnte leider nicht abgerufen werden. Bitte versuche es später erneut.
        </p>
      </div>
    </div>
  </article>
{:else if post}
  <h1 class="underline-accent">{post.title}</h1>
  <p class="text-sm text-[var(--color-neutral-700)] mt-2">
    {formatDate(post.createdAt)}
  </p>
  <p class="text-sm text-[var(--color-neutral-600)]">
    von {post.createdBy}
  </p>

  {#if post.hasImage}
    <div class="mt-6 -mx-4 md:mx-0">
      <div class="aspect-video w-full overflow-hidden rounded-none md:rounded-lg bg-[var(--color-neutral-100)]">
        <img
          src={getBlogImageUrl(post.id)}
          alt=""
          aria-hidden="true"
          class="w-full h-full object-cover"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  {/if}

  {#if post.content}
    <div class="blog-content mt-6 text-base text-[var(--color-neutral-700)] leading-relaxed prose prose-sm max-w-none">
      {@html sanitizeDescription(post.content)}
    </div>
  {:else}
    <p class="mt-6 text-sm text-[var(--color-neutral-700)]">
      Dieser Beitrag hat keinen Inhalt.
    </p>
  {/if}

  {#if post.lastModifiedAt && post.lastModifiedAt !== post.createdAt}
    <p class="mt-8 text-xs text-[var(--color-neutral-500)] border-t border-[var(--color-neutral-200)] pt-4">
      Zuletzt bearbeitet am {formatDate(post.lastModifiedAt)} von {post.lastModifiedBy}
    </p>
  {/if}

  <div class="mt-8 pt-6 border-t border-[var(--color-neutral-200)]">
    <a
      href="/blog"
      class="inline-flex items-center gap-2 px-4 py-2 rounded border border-[var(--color-neutral-300)] text-[var(--color-neutral-800)] hover:border-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition"
    >
      <svg class="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Alle Beiträge
    </a>
  </div>
{:else}
  <div class="surface p-6" aria-labelledby="blog-not-found-heading">
    <h2 id="blog-not-found-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">
      Beitrag nicht gefunden
    </h2>
    <p class="mt-2 text-sm text-[var(--color-neutral-700)]">
      Der angeforderte Blog-Beitrag konnte nicht gefunden werden.
    </p>
    <a
      href="/blog"
      class="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded border border-[var(--color-neutral-300)] text-[var(--color-neutral-800)] hover:border-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition"
    >
      Alle Beiträge anzeigen
    </a>
  </div>
{/if}

<style>
  .skeleton-element {
    background: linear-gradient(
      110deg,
      var(--color-neutral-200) 0%,
      var(--color-neutral-100) 40%,
      var(--color-neutral-200) 60%,
      var(--color-neutral-200) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-element {
      animation: none;
      background: var(--color-neutral-200);
      background-size: 100% 100%;
    }
  }

  .blog-content :global(p) {
    margin-bottom: 1rem;
  }

  .blog-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .blog-content :global(b),
  .blog-content :global(strong) {
    font-weight: 600;
    color: var(--color-neutral-800);
  }

  .blog-content :global(ul),
  .blog-content :global(ol) {
    margin-left: 1.5rem;
    margin-bottom: 1rem;
  }

  .blog-content :global(li) {
    margin-bottom: 0.25rem;
  }
</style>
