<script lang="ts">
  import type { Snippet } from 'svelte';
  import StaffIntro from './StaffIntro.svelte';
  import { staffPage } from '../lib/staffModules';

  interface Props {
    href: string;
    actions?: Snippet;
    printable?: boolean;
  }
  let { href, actions, printable = false }: Props = $props();
  const page = $derived(staffPage(href));
</script>

<header
  class:print-hidden={printable}
  class="ui-pagehead mb-4 flex flex-wrap items-end gap-x-8 gap-y-4 pb-4"
>
  <div class="min-w-0 max-w-3xl flex-1 basis-96">
    <h1
      class="ui-h ui-h--section underline-accent mb-2 font-serif text-2xl font-semibold text-brand-900 md:text-3xl"
    >
      {page.heading ?? page.title}
    </h1>
    <StaffIntro intro={page.intro ?? page.description} open={page.introOpen} />
  </div>
  {#if actions}<div class="page-head-actions flex w-full flex-wrap items-center gap-2 lg:w-auto">
      {@render actions()}
    </div>{/if}
</header>

<style>
  @media print {
    .print-hidden {
      display: none;
    }
  }
</style>
