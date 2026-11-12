<script lang="ts">
  import type { HelperRole } from '../../lib/nikolausEinteilung';
  import type { Einsaetze } from '../../lib/nikolausEinteilungKacheln';

  interface Props {
    name: string;
    /** The posts the person volunteered for that day. */
    roles: HelperRole[];
    /** The post the person holds, highlighted among the roles. */
    activeRole?: HelperRole;
    /** How often the person works over all days, in total and per post. */
    einsaetze: Einsaetze | undefined;
    selected: boolean;
    onpick: () => void;
    ondragstart: (event: DragEvent) => void;
    ondragend: () => void;
    /**
     * For a person on a team post: whether the post is held, and how to toggle it. A held
     * person cannot be moved until the pin is released.
     */
    pin?: { fixed: boolean; label: string; onclick: () => void };
  }

  let { name, roles, activeRole, einsaetze, selected, onpick, ondragstart, ondragend, pin }: Props =
    $props();

  const total = $derived(einsaetze?.total ?? 0);
  function roleText(role: HelperRole): string {
    const count = einsaetze?.byRole[role] ?? 0;
    return count > 0 ? `${role} ${count}x` : role;
  }
  const label = $derived(
    `${name} (${roles.map(roleText).join(', ')}), insgesamt ${total}x im Einsatz`
  );

  const locked = $derived(pin?.fixed === true);
  const pinLabel = $derived(
    pin ? `Posten ${pin.fixed ? 'festgehalten' : 'festhalten'}: ${pin.label}` : ''
  );
  const tileClass = $derived(
    `flex min-h-11 w-full flex-col items-start gap-1 rounded-sm border bg-surface py-1.5 pl-2.5 text-left text-sm shadow-sm ${pin ? 'pr-11' : 'pr-2.5'}`
  );
</script>

{#snippet content()}
  <span class="flex w-full items-baseline justify-between gap-2" aria-hidden="true">
    <span class="font-semibold text-brand-900">{name}</span>
    <span class="shrink-0 text-xs text-neutral-700 tabular-nums">{total}x</span>
  </span>
  <span class="flex flex-wrap gap-1" aria-hidden="true">
    {#each roles as role (role)}
      <span
        class="rounded-sm px-1.5 text-xs {role === activeRole
          ? 'bg-action text-on-action'
          : 'bg-neutral-100 text-neutral-700'}">{roleText(role)}</span
      >
    {/each}
  </span>
{/snippet}

<div class="relative">
  {#if locked}
    <div class="{tileClass} border-accent-500" role="group" aria-label={label}>
      {@render content()}
    </div>
  {:else}
    <button
      type="button"
      draggable="true"
      data-einteilung-tile
      class="{tileClass} cursor-grab active:cursor-grabbing {selected
        ? 'border-accent-500 ring-2 ring-accent-500'
        : 'border-neutral-300 hover:border-brand-900'}"
      aria-pressed={selected}
      aria-label={label}
      onclick={onpick}
      {ondragstart}
      {ondragend}
    >
      {@render content()}
    </button>
  {/if}
  {#if pin}
    <button
      type="button"
      class="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-sm {pin.fixed
        ? 'text-accent-500'
        : 'text-neutral-700 hover:text-brand-900'}"
      aria-pressed={pin.fixed}
      aria-label={pinLabel}
      title={pinLabel}
      onclick={pin.onclick}
    >
      <svg
        aria-hidden="true"
        class="size-5"
        viewBox="0 0 24 24"
        fill={pin.fixed ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
      </svg>
    </button>
  {/if}
</div>
