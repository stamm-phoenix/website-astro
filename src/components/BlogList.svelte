<script lang="ts">
  import { onMount } from "svelte";
  import { blogStore, fetchBlog } from "../lib/blogStore.svelte";
  import { sanitizeDescription, getBlogImageUrl } from "../lib/api";
  import type { BlogPost } from "../lib/types";

  onMount(() => {
    fetchBlog();
  });

  function formatDate(isoString: string): string {
    return new Date(isoString).toLocaleDateString("de-DE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function getExcerpt(html: string, maxLength: number = 120): string {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;
    const text = tempDiv.textContent || tempDiv.innerText || "";
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + "…";
  }
</script>

<div class="grid gap-6 md:grid-cols-2">
  {#if blogStore.loading}
    <div role="status" aria-live="polite" class="sr-only">
      Blog-Beiträge werden geladen...
    </div>
    {#each [1, 2, 3, 4] as _}
      <article class="skeleton-card surface p-5 border-l-4 border-l-[var(--color-neutral-300)]">
        <div class="flex gap-4">
          <div class="skeleton-element w-20 h-20 rounded-md flex-shrink-0"></div>
          <div class="flex-1 space-y-2">
            <div class="skeleton-element h-5 w-3/4 rounded"></div>
            <div class="skeleton-element h-4 w-1/2 rounded"></div>
            <div class="skeleton-element h-4 w-1/3 rounded"></div>
          </div>
        </div>
        <div class="mt-4 space-y-2">
          <div class="skeleton-element h-3 w-full rounded"></div>
          <div class="skeleton-element h-3 w-5/6 rounded"></div>
        </div>
      </article>
    {/each}
  {:else if blogStore.error}
    <div class="md:col-span-2">
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
              Die Blog-Beiträge konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
            </p>
          </div>
        </div>
      </article>
    </div>
  {:else if blogStore.data && blogStore.data.length > 0}
    {#each blogStore.data as post (post.id)}
      <a
        href={`/blog/${encodeURIComponent(post.id)}`}
        class="blog-card surface p-5 border-l-4 border-l-[var(--color-neutral-200)] block transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift hover:border-l-[var(--color-accent-500)] no-underline"
        aria-labelledby="blog-{post.id}-heading"
      >
        <article>
          <div class="flex gap-4">
            {#if post.hasImage}
              <div class="flex-shrink-0 w-20 h-20 rounded-md overflow-hidden bg-[var(--color-neutral-100)]">
                <img
                  src={getBlogImageUrl(post.id)}
                  alt=""
                  class="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            {:else}
              <div class="flex-shrink-0 w-20 h-20 rounded-md bg-gradient-to-br from-[var(--color-brand-50)] to-[var(--color-neutral-100)] flex items-center justify-center">
                <svg class="w-8 h-8 text-[var(--color-brand-300)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
              </div>
            {/if}
            <div class="flex-1 min-w-0">
              <h3 id="blog-{post.id}-heading" class="text-lg font-semibold text-[var(--color-brand-900)] leading-snug line-clamp-2">
                {post.title}
              </h3>
              <p class="text-sm text-[var(--color-neutral-700)] mt-1">
                {formatDate(post.createdAt)}
              </p>
              <p class="text-xs text-[var(--color-neutral-600)] mt-0.5">
                von {post.createdBy}
              </p>
            </div>
          </div>

          {#if post.content}
            <p class="mt-3 text-sm text-[var(--color-neutral-700)] line-clamp-2">
              {getExcerpt(post.content)}
            </p>
          {/if}

          <div class="mt-3 flex items-center gap-1 text-sm font-medium text-[var(--color-brand-700)]">
            <span>Weiterlesen</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </article>
      </a>
    {/each}
  {:else}
    <div class="md:col-span-2">
      <div class="surface p-8 text-center">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center">
          <svg class="w-8 h-8 text-[var(--color-brand-300)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
        </div>
        <p class="text-[var(--color-neutral-700)]">
          Aktuell sind keine Blog-Beiträge vorhanden.
        </p>
      </div>
    </div>
  {/if}
</div>

<style>
  .skeleton-card {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

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

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.85;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-card {
      animation: none;
    }
    .skeleton-element {
      animation: none;
      background: var(--color-neutral-200);
      background-size: 100% 100%;
    }
  }

  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
