<script lang="ts">
  import EinteilungPersonTile from './EinteilungPersonTile.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { formatShortDate } from '../../lib/nikolausAdmin';
  import {
    KITCHEN,
    OPEN_REASON_LABELS,
    REQUIRED_ROLES,
    TEAM_ROLES,
    conflictingTags,
  } from '../../lib/nikolausEinteilung';
  import type {
    EinteilungAssignment,
    EinteilungDay,
    EinteilungPerson,
    EinteilungResult,
    TeamRole,
  } from '../../lib/nikolausEinteilung';
  import { canTake, moveTile, rolesOn } from '../../lib/nikolausEinteilungKacheln';
  import type { Einsaetze, Parked, TileTarget } from '../../lib/nikolausEinteilungKacheln';

  interface Props {
    day: EinteilungDay;
    persons: Map<string, EinteilungPerson>;
    /** Team posts of all days. */
    assignments: EinteilungAssignment[];
    /** Persons in the box „Ohne Posten“, of all days. */
    parked: Parked;
    result: EinteilungResult;
    /** Posts per person over all days. */
    einsaetze: Map<string, Einsaetze>;
    /** Ready teams as `date|team`. */
    ready: Set<string>;
    teamColor: Map<string, string>;
    onchange: (assignments: EinteilungAssignment[], parked: Parked) => void;
    ontogglefixed: (assignment: EinteilungAssignment) => void;
  }

  let {
    day,
    persons,
    assignments,
    parked,
    result,
    einsaetze,
    ready,
    teamColor,
    onchange,
    ontogglefixed,
  }: Props = $props();

  /** The person picked up by tap or drag, to be placed on a post, the kitchen or the box. */
  let held = $state<string | null>(null);
  /** The drop zone under the dragged tile: `team|role`, the kitchen or the box. */
  let dropTarget = $state<string | null>(null);
  /** Whether `held` was picked up by dragging; the tap controls stay hidden then. */
  let dragging = $state(false);
  let root = $state<HTMLElement>();

  const BOX = 'parken';
  const date = $derived(day.date);
  const heldPerson = $derived(held ? persons.get(held) : undefined);
  const heldPost = $derived(
    held ? assignments.find((a) => a.date === date && a.personId === held) : undefined
  );
  const kitchen = $derived(
    result.assignments
      .filter((a) => a.date === date && a.team === KITCHEN)
      .map((a) => a.personId)
      .sort(byName)
  );
  const idle = $derived([...(result.idle[date] ?? [])].sort(byName));
  // Also who sits in the box without being put aside there, so recalculating leaves them out
  const canPark = $derived(held !== null && !(parked[date] ?? []).includes(held));
  const canCook = $derived(
    held !== null && rolesOn(heldPerson, date).includes(KITCHEN) && !kitchen.includes(held)
  );

  function name(personId: string): string {
    return persons.get(personId)?.name ?? '?';
  }

  function byName(a: string, b: string): number {
    return name(a).localeCompare(name(b), 'de');
  }

  function assigned(team: string, role: TeamRole): EinteilungAssignment | undefined {
    return assignments.find((a) => a.date === date && a.team === team && a.role === role);
  }

  function missing(team: string): string[] {
    return REQUIRED_ROLES.filter((role) => !assigned(team, role));
  }

  /** Whether the held person can go onto this post; a held post keeps its person. */
  function fits(team: string, role: TeamRole): boolean {
    return (
      heldPerson !== undefined &&
      canTake(heldPerson, date, role) &&
      !(heldPost?.team === team && heldPost.role === role) &&
      !assigned(team, role)?.fixed
    );
  }

  function tagWarning(team: string, role: TeamRole): string[] {
    return heldPerson ? conflictingTags(heldPerson, day.familyTags?.[team], role) : [];
  }

  function pick(personId: string): void {
    held = held === personId ? null : personId;
  }

  function place(target: TileTarget): void {
    const personId = held;
    held = null;
    dropTarget = null;
    if (!personId) return;
    const next = moveTile(assignments, parked, persons, date, personId, target);
    if (next.assignments !== assignments || next.parked !== parked) {
      onchange(next.assignments, next.parked);
    }
  }

  function startDrag(event: DragEvent, personId: string): void {
    held = personId;
    dragging = true;
    event.dataTransfer?.setData('text/plain', personId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function endDrag(): void {
    // A drop has already placed the tile and cleared `held`; otherwise the drag was cancelled
    held = null;
    dropTarget = null;
    dragging = false;
  }

  function over(event: DragEvent, key: string, allowed: boolean): void {
    if (!allowed) return;
    event.preventDefault();
    dropTarget = key;
  }

  function leave(key: string): void {
    if (dropTarget === key) dropTarget = null;
  }

  function zoneClass(key: string, allowed: boolean, idleBorder = 'border-transparent'): string {
    if (dropTarget === key) return 'border-success bg-success-soft';
    if (allowed) return 'border-[var(--color-brand-400)] bg-[var(--color-brand-50)]';
    return idleBorder;
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && held) held = null;
  }}
  onclick={(event) => {
    // A click anywhere but on a tile of this day drops the selection; the buttons that place
    // the held person have already done their work by then
    const target = event.target instanceof Element ? event.target : null;
    if (held && !(target?.closest('[data-einteilung-tile]') && root?.contains(target))) {
      held = null;
    }
  }}
  ondragover={(event) => {
    // A tile pulled out of a post may be dropped anywhere on the page
    if (dragging && heldPost) event.preventDefault();
  }}
  ondrop={(event) => {
    // The drop zones of the board have already handled their drop
    if (event.defaultPrevented || !dragging || !heldPost) return;
    event.preventDefault();
    place('parken');
  }}
/>

{#snippet tile(
  personId: string,
  activeRole?: EinteilungAssignment['role'],
  pin?: { fixed: boolean; label: string; onclick: () => void }
)}
  <EinteilungPersonTile
    name={name(personId)}
    roles={rolesOn(persons.get(personId), date)}
    {activeRole}
    einsaetze={einsaetze.get(personId)}
    selected={held === personId}
    onpick={() => pick(personId)}
    ondragstart={(event) => startDrag(event, personId)}
    ondragend={endDrag}
    {pin}
  />
{/snippet}

<div class="space-y-6" bind:this={root}>
  {#if heldPerson && !dragging}
    <div
      class="surface fixed inset-x-3 bottom-[calc(0.75rem+var(--staff-bar-h,env(safe-area-inset-bottom,0px)))] z-30 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-2 border-accent-500 p-3 text-sm shadow-lg"
      role="status"
    >
      <p>
        <strong>{heldPerson.name}</strong> ausgewählt – wähle „Hierher“ bei einem Posten.
      </p>
      <ActionButton type="button" onclick={() => (held = null)}>Abbrechen</ActionButton>
    </div>
  {/if}

  <section
    aria-labelledby="ohne-posten-{date}"
    class="rounded-sm border-2 border-dashed p-3 transition-colors {zoneClass(
      BOX,
      canPark,
      'border-neutral-300'
    )}"
    ondragover={(event) => over(event, BOX, canPark)}
    ondragleave={() => leave(BOX)}
    ondrop={(event) => {
      event.preventDefault();
      if (canPark) place('parken');
    }}
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="ohne-posten-{date}" class="font-semibold text-brand-900">
        Ohne Posten <span class="font-normal text-neutral-700">({idle.length})</span>
      </h3>
      {#if canPark && !dragging}
        <ActionButton
          type="button"
          aria-label={`${heldPerson?.name} ohne Posten lassen`}
          onclick={() => place('parken')}>Hierher</ActionButton
        >
      {/if}
    </div>
    {#if idle.length === 0}
      <p class="mt-1 text-sm text-neutral-700">Niemand.</p>
    {:else}
      <ul class="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        {#each idle as personId (personId)}
          <li>{@render tile(personId)}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="grid gap-x-6 gap-y-8 sm:grid-cols-2 {day.teams.length >= 3 ? 'xl:grid-cols-4' : ''}">
    {#each day.teams as team (team)}
      <section
        aria-labelledby="einteilung-{date}-{team}"
        class="border-t-4"
        style:border-top-color={teamColor.get(team)}
      >
        <h3
          id="einteilung-{date}-{team}"
          class="border-b border-neutral-200 py-2 font-serif text-lg font-semibold text-brand-900"
        >
          Team {team}
        </h3>
        <p class="pt-1">
          {#if ready.has(`${date}|${team}`)}
            <StatusLabel tone="success" label="Kann losfahren" />
          {:else}
            <StatusLabel
              tone="danger"
              label={`Kann nicht losfahren – es ${missing(team).length === 1 ? 'fehlt' : 'fehlen'} ${missing(team).join(' und ')}`}
            />
          {/if}
        </p>
        <ul class="divide-y divide-neutral-200 text-sm">
          {#each TEAM_ROLES as role (role)}
            {@const current = assigned(team, role)}
            {@const open = result.open.find(
              (o) => o.date === date && o.team === team && o.role === role
            )}
            {@const key = `${team}|${role}`}
            {@const allowed = fits(team, role)}
            {@const tags = allowed ? tagWarning(team, role) : []}
            <li class="py-2.5" aria-label={`${role} in Team ${team}`}>
              <p class="font-semibold text-brand-900">{role}</p>
              <div
                role="presentation"
                class="mt-1 space-y-2 rounded-sm border-2 border-dashed p-1 transition-colors {zoneClass(
                  key,
                  allowed
                )}"
                ondragover={(event) => over(event, key, allowed)}
                ondragleave={() => leave(key)}
                ondrop={(event) => {
                  event.preventDefault();
                  if (allowed) place({ team, role });
                }}
              >
                {#if current}
                  {@render tile(current.personId, role, {
                    fixed: current.fixed,
                    label: `${role} in Team ${team} am ${formatShortDate(date)}`,
                    onclick: () => ontogglefixed(current),
                  })}
                {:else}
                  <p
                    class="flex min-h-11 items-center rounded-sm border border-danger bg-danger-soft px-2.5 text-danger"
                  >
                    offen
                  </p>
                {/if}
                {#if allowed && !dragging}
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center justify-center rounded-sm border border-brand-900 px-2 text-sm font-semibold text-brand-900 hover:bg-neutral-100"
                    aria-label={`${heldPerson?.name} als ${role} in Team ${team} einteilen`}
                    onclick={() => place({ team, role })}
                  >
                    Hierher{current ? ` (statt ${name(current.personId)})` : ''}
                  </button>
                  {#if tags.length > 0}
                    <p class="text-xs text-warning">
                      Passt nicht zu Familien mit „{tags.join('“, „')}“.
                    </p>
                  {/if}
                {/if}
              </div>
              {#if open}
                <p class="mt-1 text-xs text-danger">{OPEN_REASON_LABELS[open.reason]}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>

  <section
    aria-labelledby="kitchen-{date}"
    class="rounded-sm border-2 border-dashed p-3 transition-colors {zoneClass(
      KITCHEN,
      canCook,
      'border-neutral-300'
    )}"
    ondragover={(event) => over(event, KITCHEN, canCook)}
    ondragleave={() => leave(KITCHEN)}
    ondrop={(event) => {
      event.preventDefault();
      if (canCook) place(KITCHEN);
    }}
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="kitchen-{date}" class="font-semibold text-brand-900">
        Küche <span class="font-normal text-neutral-700">({kitchen.length})</span>
      </h3>
      {#if canCook && !dragging}
        <ActionButton
          type="button"
          aria-label={`${heldPerson?.name} in die Küche einteilen`}
          onclick={() => place(KITCHEN)}>Hierher</ActionButton
        >
      {/if}
    </div>
    {#if kitchen.length === 0}
      <p class="mt-1 text-sm text-neutral-700">Niemand.</p>
    {:else}
      <ul class="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        {#each kitchen as personId (personId)}
          <li>{@render tile(personId, KITCHEN)}</li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
