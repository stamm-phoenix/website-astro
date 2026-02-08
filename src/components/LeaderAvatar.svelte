<script lang="ts">
  import { getLeaderImageUrl } from "../lib/api";

  interface Props {
    id: string;
    name: string;
    hasImage: boolean;
    size?: "sm" | "md" | "ml" | "lg";
  }

  let { id, name, hasImage, size = "md" }: Props = $props();

  const sizeConfig = {
    sm: { container: "w-9 h-9", text: "text-xs", ring: "ring-2" },
    md: { container: "w-12 h-12", text: "text-sm", ring: "ring-2" },
    ml: { container: "w-14 h-14", text: "text-base", ring: "ring-2" },
    lg: { container: "w-20 h-20", text: "text-lg", ring: "ring-3" },
  };

  let imageError = $state(false);
  let imageLoaded = $state(false);

  const showFallback = $derived(!hasImage || imageError);
  const initials = $derived(
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
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
  class="avatar-container {config.container} relative rounded-full overflow-hidden shadow-md ring-[var(--color-brand-200)] {config.ring} transition-all duration-200 hover:scale-105 hover:shadow-lg hover:ring-[var(--color-brand-400)]"
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
      <div class="absolute inset-0 avatar-shimmer"></div>
    {/if}
  {/if}

  {#if showFallback}
    <div
      class="absolute inset-0 flex items-center justify-center avatar-fallback {config.text} font-semibold text-[var(--color-brand-800)] select-none"
    >
      {initials}
    </div>
  {/if}
</div>

<style>
  .avatar-fallback {
    background: linear-gradient(
      145deg,
      var(--color-brand-100) 0%,
      var(--color-brand-200) 50%,
      var(--color-neutral-200) 100%
    );
  }

  .avatar-shimmer {
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
</style>
