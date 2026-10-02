<script lang="ts">
  import { getLeaderImageUrl } from '../lib/api';

  interface Props {
    id: string;
    name: string;
    hasImage: boolean;
    size?: 'sm' | 'md' | 'ml' | 'lg';
  }

  let { id, name, hasImage, size = 'md' }: Props = $props();

  const sizeConfig = {
    sm: { container: 'w-9 h-9', text: 'text-xs' },
    md: { container: 'w-12 h-12', text: 'text-sm' },
    ml: { container: 'w-14 h-14', text: 'text-base' },
    lg: { container: 'w-20 h-20', text: 'text-lg' },
  };

  let imageError = $state(false);
  let imageLoaded = $state(false);

  const showFallback = $derived(!hasImage || imageError);
  const initials = $derived(
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  );

  const config = $derived(sizeConfig[size]);

  function handleImageError() {
    imageError = true;
  }

  function handleImageLoad() {
    imageLoaded = true;
  }
</script>

<div
  class="avatar-container {config.container} relative flex-shrink-0 overflow-hidden rounded-full border border-neutral-200"
  title={name}
>
  {#if !showFallback}
    <img
      src={getLeaderImageUrl(id)}
      alt={name}
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
      {initials}
    </div>
  {/if}
</div>

<style>
  /* Initials on plain paper colour, no gradient */
  .avatar-fallback {
    background: var(--color-brand-50);
  }
</style>
