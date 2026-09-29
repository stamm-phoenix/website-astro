<script lang="ts">
  import { INSTAGRAM_PROFILE_URL } from '../lib/instagramStore.svelte';
</script>

<!-- Link to our Instagram profile, styled like the other outline buttons of the site -->
<a
  href={INSTAGRAM_PROFILE_URL}
  target="_blank"
  rel="noopener noreferrer"
  class="inline-flex w-fit items-center gap-2 rounded-sm border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-900 no-underline transition hover:border-brand-900 hover:text-brand-900"
>
  <!-- Line icon in the style of the type badges, in the text colour -->
  <svg
    class="size-4 text-brand-900"
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
