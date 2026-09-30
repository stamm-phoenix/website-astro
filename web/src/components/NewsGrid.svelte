<script lang="ts">
  import BlogPostCard from './BlogPostCard.svelte';
  import InstagramConsentDialog from './InstagramConsentDialog.svelte';
  import InstagramPostCard from './InstagramPostCard.svelte';
  import NewsModal from './NewsModal.svelte';
  import type { InstagramConsentRequest } from '../lib/instagramStore.svelte';
  import type { NewsItem } from '../lib/newsFeed';

  interface Props {
    items: NewsItem[];
    /** Heading level of the blog post titles within the page. */
    headingLevel?: 2 | 3;
    label?: string;
  }
  let { items, headingLevel = 3, label }: Props = $props();

  /** Post shown large in the dialog */
  let openItem = $state<NewsItem | null>(null);
  /** Instagram link or video waiting for confirmation; shown above the post dialog */
  let consent = $state<InstagramConsentRequest | null>(null);
</script>

<ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-label={label}>
  {#each items as item, index (item.key)}
    <li>
      {#if item.type === 'blog'}
        <BlogPostCard
          post={item.post}
          {headingLevel}
          imageClass="aspect-[4/3]"
          showType
          onopen={() => (openItem = item)}
        />
      {:else}
        <InstagramPostCard
          post={item.post}
          autoAdvanceOffset={index * 900}
          onopen={() => (openItem = item)}
        />
      {/if}
    </li>
  {/each}
</ul>
<NewsModal
  item={openItem}
  onclose={() => (openItem = null)}
  onconsent={(request) => (consent = request)}
/>
<InstagramConsentDialog request={consent} onclose={() => (consent = null)} />
