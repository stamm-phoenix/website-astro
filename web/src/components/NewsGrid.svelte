<script lang="ts">
  import BlogPostCard from './BlogPostCard.svelte';
  import InstagramLeaveDialog from './InstagramLeaveDialog.svelte';
  import InstagramPostCard from './InstagramPostCard.svelte';
  import type { NewsItem } from '../lib/newsFeed';

  interface Props {
    items: NewsItem[];
    /** Heading level of the blog post titles within the page. */
    headingLevel?: 2 | 3;
    label?: string;
  }
  let { items, headingLevel = 3, label }: Props = $props();

  /** Instagram post waiting for confirmation before it is opened */
  let leaveHref = $state<string | null>(null);
</script>

<ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label={label}>
  {#each items as item, index (item.key)}
    <li>
      {#if item.type === 'blog'}
        <BlogPostCard post={item.post} {headingLevel} imageClass="aspect-[4/3]" showType />
      {:else}
        <InstagramPostCard
          post={item.post}
          autoAdvanceOffset={index * 900}
          onleave={(href) => (leaveHref = href)}
        />
      {/if}
    </li>
  {/each}
</ul>
<InstagramLeaveDialog href={leaveHref} onclose={() => (leaveHref = null)} />
