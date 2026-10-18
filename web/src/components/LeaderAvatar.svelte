<script lang="ts">
  import { getLeaderImageUrl } from '../lib/api';

  interface Props {
    id: string;
    name: string;
    hasImage: boolean;
    size?: 'sm' | 'md' | 'ml' | 'lg' | 'xl';
    version?: number;
    decorative?: boolean;
  }

  let { id, name, hasImage, size = 'md', version, decorative = false }: Props = $props();

  const sizeConfig = {
    sm: { container: 'w-9 h-9', text: 'text-xs' },
    md: { container: 'w-12 h-12', text: 'text-sm' },
    ml: { container: 'w-14 h-14', text: 'text-base' },
    lg: { container: 'w-20 h-20', text: 'text-lg' },
    xl: { container: 'w-24 h-24', text: 'text-2xl' },
  };

  let errorUrl = $state('');
  let loadedUrl = $state('');
  const imageUrl = $derived(
    `${getLeaderImageUrl(id)}${version === undefined ? '' : `?v=${version}`}`
  );
  const imageLoaded = $derived(loadedUrl === imageUrl);

  const showFallback = $derived(!hasImage || !id || errorUrl === imageUrl);
  const initials = $derived(
    name
      .split(/\s+/)
      .map((part) => /\p{L}/u.exec(part)?.[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
  );

  const config = $derived(sizeConfig[size]);

  function handleImageError() {
    errorUrl = imageUrl;
  }

  function handleImageLoad() {
    loadedUrl = imageUrl;
  }
</script>

<div
  class="avatar-container {config.container} relative flex-shrink-0 overflow-hidden rounded-full border border-neutral-200"
  title={decorative ? undefined : name}
  aria-hidden={decorative ? 'true' : undefined}
>
  {#if !showFallback}
    <img
      src={imageUrl}
      alt={decorative ? '' : name}
      width="96"
      height="96"
      class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
      class:opacity-0={!imageLoaded}
      class:opacity-100={imageLoaded}
      onerror={handleImageError}
      onload={handleImageLoad}
      loading="lazy"
      decoding="async"
    />
    {#if !imageLoaded}
      <div class="absolute inset-0 skeleton-element"></div>
    {/if}
  {/if}

  {#if showFallback}
    <div
      class="absolute inset-0 flex items-center justify-center avatar-fallback {config.text} font-semibold text-brand-900 select-none"
    >
      {initials || '?'}
    </div>
  {/if}
</div>

<style>
  /* Initials on plain paper colour, no gradient */
  .avatar-fallback {
    background: var(--color-brand-50);
  }
</style>
