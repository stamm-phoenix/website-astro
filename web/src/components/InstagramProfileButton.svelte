<script lang="ts">
  import { INSTAGRAM_PROFILE_URL } from '../lib/instagramStore.svelte';
</script>

<!-- Link to our Instagram profile, styled as secondary button -->
<a
  href={INSTAGRAM_PROFILE_URL}
  target="_blank"
  rel="noopener noreferrer"
  class="btn-secondary w-fit no-underline"
>
  <!-- Line icon in the text colour -->
  <svg
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
  </svg>
  @dpsg_stammphoenix <span aria-hidden="true">↗</span>
  <span class="sr-only">auf Instagram (öffnet in neuem Tab)</span>
</a>
