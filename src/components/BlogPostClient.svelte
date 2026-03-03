<script lang="ts">
  import { onMount } from 'svelte';
  import { blogPosts } from '../lib/blogData';
  import type { BlogPost } from '../lib/blogData';

  let post: BlogPost | null = null;
  let relatedPosts: BlogPost[] = [];
  let loading = true;
  let error = false;

  const getSlug = () => {
    if (typeof window === 'undefined') return null;
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'blog' && parts.length > 1) return decodeURIComponent(parts[1]);
    const params = new URLSearchParams(window.location.search);
    return params.get('slug');
  };

  const loadFromFallback = (slug: string | null) => {
    const fallbackPost = blogPosts.find((item) => item.id === slug) ?? blogPosts[0];
    if (!fallbackPost) return;
    post = fallbackPost;
    relatedPosts = blogPosts.filter((item) => item.id !== fallbackPost.id).slice(0, 2);
  };

  onMount(async () => {
    const slug = getSlug();
    if (!slug) {
      loading = false;
      return;
    }
    try {
      loading = true;
      const response = await fetch('/api/blog');
      if (!response.ok) throw new Error('Failed to load blog posts');
      const data = await response.json();
      const posts = Array.isArray(data) ? data : data?.items;
      if (!Array.isArray(posts)) throw new Error('Invalid blog response');
      const matched = posts.find((item: BlogPost) => item.id === slug) ?? posts[0];
      if (!matched) throw new Error('No blog posts');
      post = matched;
      relatedPosts = posts.filter((item: BlogPost) => item.id !== matched.id).slice(0, 2);
    } catch {
      error = true;
      loadFromFallback(slug);
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  <div class="surface-muted p-6" role="status" aria-live="polite">
    <div class="space-y-3">
      <div class="h-3 w-24 rounded-full skeleton-element"></div>
      <div class="h-6 w-2/3 rounded-full skeleton-element"></div>
      <div class="h-4 w-1/3 rounded-full skeleton-element"></div>
      <div class="h-48 w-full rounded-[var(--radius-md)] skeleton-element"></div>
    </div>
  </div>
{:else if post}
  <article class="mt-10 space-y-10">
    <header class="space-y-6">
      <p class="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-700)]">
        {post.category}
      </p>
      <h1
        class="underline-accent mb-8 text-3xl md:text-4xl font-serif font-semibold text-brand-900"
      >
        {post.title}
      </h1>
      <div class="flex flex-wrap items-center gap-3 text-sm text-neutral-700">
        <span class="font-semibold text-brand-900">
          {new Date(post.date).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
        </span>
        <span aria-hidden="true">•</span>
        <span>{post.readTime} Lesezeit</span>
      </div>
    </header>

    <div class="surface overflow-hidden">
      <img
        src={post.image.src}
        alt={post.image.alt}
        width="1400"
        height="800"
        class="h-72 w-full object-cover md:h-96"
        loading="lazy"
        decoding="async"
      />
      <div class="p-6 md:p-8 space-y-5 text-neutral-700">
        <p class="text-lg text-neutral-800">{post.excerpt}</p>
        <p>
          Unsere Gruppenleiter:innen haben mit viel Herz geplant, ausprobiert und gemeinsam mit
          allen Kindern umgesetzt. Es war ein Wochenende voller kleiner Herausforderungen, neuer
          Freundschaften und ganz viel Pfadfindergeist.
        </p>
        <p>
          Zwischen Lagerfeuer, Nachtwanderung und kreativen Aktionen gab es viele Momente, die uns
          als Stamm enger zusammengebracht haben. Genau solche Augenblicke erzählen wir im Blog.
        </p>
        <p>
          Hast du Fragen oder möchtest du beim nächsten Mal dabei sein? Melde dich gern bei uns –
          wir freuen uns auf neue Gesichter.
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-4">
      <a
        href="/blog"
        class="inline-flex items-center rounded-sm border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-900 transition hover:border-brand-900 hover:text-brand-900"
      >
        Zurück zum Blog
        <span aria-hidden="true" class="ml-2">→</span>
      </a>
      <span
        class={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${post.color}`}
      >
        {post.category}
      </span>
    </div>
  </article>

  {#if relatedPosts.length > 0}
    <section class="mt-12" aria-labelledby="related-posts">
      <h2
        class="text-2xl md:text-3xl font-serif font-semibold text-brand-900 underline-accent mb-8"
        id="related-posts"
      >
        Weitere Geschichten
      </h2>
      <div class="grid gap-6 md:grid-cols-2">
        {#each relatedPosts as item}
          <article
            class="surface p-5 transition duration-150 hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div class="flex flex-col gap-4">
              <div class="flex items-center justify-between gap-3">
                <span
                  class={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${item.color}`}
                >
                  {item.category}
                </span>
                <span class="text-xs text-neutral-600">
                  {new Date(item.date).toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <h3 class="text-lg font-semibold text-brand-900">
                <a
                  href={`/blog/${item.id}`}
                  class="no-underline text-brand-900 hover:text-brand-700"
                >
                  {item.title}
                </a>
              </h3>
              <p class="text-sm text-neutral-700">{item.excerpt}</p>
            </div>
          </article>
        {/each}
      </div>
    </section>
  {/if}
{:else}
  <div class="surface-muted p-6">
    <p class="text-neutral-700">Dieser Beitrag ist gerade nicht verfügbar.</p>
  </div>
{/if}

{#if error}
  <p class="mt-4 text-xs text-neutral-600">
    Beiträge konnten nicht geladen werden. Es wird der Offline-Entwurf angezeigt.
  </p>
{/if}
