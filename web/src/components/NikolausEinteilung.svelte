<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, sendApi } from '../lib/api';
  import { NIKOLAUS_TEAMS } from '../lib/nikolausConfig';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import {
    KITCHEN,
    OPEN_REASON_LABELS,
    TEAM_ROLES,
    completeEinteilung,
    conflictingTags,
    solveEinteilung,
  } from '../lib/nikolausEinteilung';
  import type {
    EinteilungAssignment,
    EinteilungPerson,
    EinteilungProblem,
    TeamRole,
  } from '../lib/nikolausEinteilung';
  import type {
    StaffNikolausEinteilungData,
    StaffNikolausEinteilungRow,
    StaffNikolausHelper,
  } from '../lib/types';
  import { einteilungStore, fetchEinteilung } from '../lib/nikolausHelfendeStore.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  interface Props {
    data: StaffNikolausEinteilungData;
  }

  let { data }: Props = $props();

  /** Team posts only; kitchen and idle persons are derived. */
  let teamAssignments = $state<EinteilungAssignment[]>([]);
  let dirty = $state(false);
  let saving = $state(false);
  let conflict = $state(false);
  let notice = $state<{ text: string; kind: 'success' | 'warning' | 'error' } | null>(null);

  const teamColor = new Map(NIKOLAUS_TEAMS.map((team) => [team.name, team.color]));

  function toPerson(helper: StaffNikolausHelper): EinteilungPerson {
    return {
      id: helper.id,
      name: helper.name,
      availability: helper.availability,
      positiveTags: helper.positiveTags,
      negativeTags: helper.negativeTags,
    };
  }

  const problem = $derived<EinteilungProblem>({
    persons: data.persons.map(toPerson),
    days: data.days,
  });
  const personById = $derived(new Map(data.persons.map((p) => [p.id, p])));
  const result = $derived(completeEinteilung(problem, teamAssignments));

  /** Days with a post in a team, per person. */
  const workload = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const a of teamAssignments) counts[a.personId] = (counts[a.personId] ?? 0) + 1;
    return Object.entries(counts)
      .map(([id, count]) => ({ name: personById.get(id)?.name ?? '?', count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
  });

  function fromRows(rows: StaffNikolausEinteilungRow[]): EinteilungAssignment[] {
    return rows
      .filter((row) => row.team !== KITCHEN && personById.has(row.personId))
      .map((row) => ({ ...row }));
  }

  // Build the working state from the loaded data: the saved Einteilung or a new suggestion
  $effect(() => {
    const current = data;
    untrack(() => {
      conflict = false;
      if (current.rows.length === 0 && current.persons.length > 0) {
        teamAssignments = teamOnly(solveEinteilung(problem).assignments);
        dirty = true;
        notice = { text: 'Vorschlag berechnet – noch nicht gespeichert.', kind: 'warning' };
      } else {
        teamAssignments = fromRows(current.rows);
        dirty = false;
      }
    });
  });

  function teamOnly(assignments: EinteilungAssignment[]): EinteilungAssignment[] {
    return assignments.filter((a) => a.team !== KITCHEN);
  }

  function recalculate(): void {
    const fixed = teamAssignments.filter((a) => a.fixed);
    teamAssignments = teamOnly(solveEinteilung({ ...problem, fixed }).assignments);
    dirty = true;
    notice = { text: 'Neu berechnet – noch nicht gespeichert.', kind: 'warning' };
  }

  function assigned(date: string, team: string, role: TeamRole): EinteilungAssignment | undefined {
    return teamAssignments.find((a) => a.date === date && a.team === team && a.role === role);
  }

  /** Sets a post by hand; the person leaves any other post of the day. */
  function setPost(date: string, team: string, role: TeamRole, personId: string): void {
    const rest = teamAssignments.filter(
      (a) =>
        !(a.date === date && a.team === team && a.role === role) &&
        !(a.date === date && a.personId === personId)
    );
    teamAssignments = personId ? [...rest, { personId, date, team, role, fixed: true }] : rest;
    dirty = true;
    notice = null;
  }

  function toggleFixed(assignment: EinteilungAssignment): void {
    teamAssignments = teamAssignments.map((a) =>
      a === assignment ? { ...a, fixed: !a.fixed } : a
    );
    dirty = true;
  }

  /** Persons who volunteered for a post that day, with a hint why they may not fit. */
  function candidates(date: string, team: string, role: TeamRole) {
    const families = data.days.find((d) => d.date === date)?.familyTags?.[team];
    return data.persons
      .filter((p) => (p.availability[date] ?? []).includes(role))
      .map((person) => {
        const elsewhere = teamAssignments.find(
          (a) =>
            a.date === date && a.personId === person.id && !(a.team === team && a.role === role)
        );
        const tags = conflictingTags(person, families);
        const hints = [
          elsewhere ? `schon Team ${elsewhere.team} ${elsewhere.role}` : '',
          tags.length > 0 ? `Tag-Konflikt: ${tags.join(', ')}` : '',
        ].filter(Boolean);
        return {
          id: person.id,
          label: hints.length ? `${person.name} (${hints.join('; ')})` : person.name,
        };
      });
  }

  function name(personId: string): string {
    return personById.get(personId)?.name ?? '?';
  }

  async function save(): Promise<void> {
    saving = true;
    notice = null;
    try {
      const saved = await sendApi<{ rows: StaffNikolausEinteilungRow[]; version: string }>(
        'PUT',
        '/intern/pflege/nikolaus-einteilung',
        {
          version: data.version,
          assignments: result.assignments.map((a) => ({
            personId: a.personId,
            date: a.date,
            team: a.team,
            role: a.role,
            fixed: a.fixed,
          })),
        }
      );
      einteilungStore.data = { ...data, rows: saved.rows, version: saved.version };
      notice = { text: 'Einteilung gespeichert.', kind: 'success' };
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        conflict = true;
        notice = {
          text: 'Die Einteilung wurde inzwischen von jemand anderem geändert. Bitte neu laden – deine Änderungen gehen dabei verloren.',
          kind: 'error',
        };
      } else {
        notice = {
          text:
            error instanceof ApiError && error.fields?.assignments
              ? error.fields.assignments
              : 'Die Speicherung konnte nicht bestätigt werden. Dein Entwurf bleibt erhalten. Klicke erneut auf Speichern, um dieselbe vollständige Einteilung zu sichern. Bei einem Konflikt lade den aktuellen Stand neu.',
          kind: 'error',
        };
      }
    } finally {
      saving = false;
    }
  }

  function reload(): void {
    if (dirty && !confirm('Die Änderungen sind noch nicht gespeichert. Trotzdem neu laden?'))
      return;
    notice = null;
    void fetchEinteilung();
  }

  $effect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
    <p class="text-sm text-neutral-700">
      Posten werden in dieser Reihenfolge besetzt: Nikolaus, Krampus, Fahrer*in, Engerl. Danach wird
      die Arbeit auf möglichst viele Personen verteilt, dann zählen positive Tags.
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="btn-secondary"
        onclick={recalculate}
        title="Fixierte Posten bleiben"
      >
        Neu berechnen
      </button>
      <button type="button" class="btn-secondary" onclick={() => window.print()}>Drucken</button>
      <button
        type="button"
        class="btn-secondary"
        disabled={einteilungStore.loading}
        onclick={reload}
      >
        {einteilungStore.loading ? 'Lädt …' : 'Neu laden'}
      </button>
      <button
        type="button"
        class="btn-primary"
        disabled={!dirty || saving || conflict}
        onclick={save}
      >
        {saving ? 'Speichert …' : 'Speichern'}
      </button>
    </div>
  </div>

  <StatusNotice message={notice?.text ?? null} kind={notice?.kind} class="print:hidden" />

  {#if data.persons.length === 0}
    <p class="surface p-6 text-sm text-neutral-800">
      Noch keine Helfenden eingetragen. Bitte zuerst in der Ansicht „Helfende“ Personen anlegen.
    </p>
  {:else}
    {#each data.days as day (day.date)}
      {@const dayConflicts = result.conflicts.filter((c) => c.date === day.date)}
      {@const kitchen = result.assignments.filter((a) => a.date === day.date && a.team === KITCHEN)}
      {@const idle = result.idle[day.date] ?? []}
      <section aria-labelledby="einteilung-{day.date}" class="einteilung-day space-y-3">
        <h2 id="einteilung-{day.date}" class="font-serif text-2xl font-semibold text-brand-900">
          {formatShortDate(day.date)}
        </h2>

        {#if day.familyTags === null}
          <p
            class="rounded-md border border-[#f5cf9f] bg-[#fff1e0] px-3 py-2 text-sm text-[#8a4a00]"
          >
            Für diesen Tag ist in der Dispo noch keine Verteilung der Familien auf die Teams
            gespeichert. Tags werden erst geprüft, wenn die Dispo gespeichert ist.
            <a
              class="font-semibold underline print:hidden"
              href="/leitendenbereich/nikolaus-dispo?tag={day.date}">Zur Dispo dieses Tages</a
            >
          </p>
        {/if}
        {#each dayConflicts as c (c.personId + c.team)}
          <p
            class="rounded-md border border-[#e5b8bd] bg-[#f7e3e5] px-3 py-2 text-sm font-semibold text-[var(--color-dpsg-red)]"
          >
            ⚠ {name(c.personId)} ist in Team {c.team}, dort gibt es eine Familie mit dem Tag „{c.tags.join(
              '“, „'
            )}“.
          </p>
        {/each}

        <div class="grid gap-4 sm:grid-cols-2 {day.teams.length >= 3 ? 'xl:grid-cols-4' : ''}">
          {#each day.teams as team (team)}
            <section
              aria-labelledby="einteilung-{day.date}-{team}"
              class="overflow-hidden rounded-[var(--radius-lg)] border border-neutral-200 bg-white"
            >
              <h3
                id="einteilung-{day.date}-{team}"
                class="px-4 py-2 font-serif text-lg font-semibold text-white"
                style:background={teamColor.get(team)}
              >
                Team {team}
              </h3>
              <dl class="space-y-3 p-3 text-sm">
                {#each TEAM_ROLES as role (role)}
                  {@const current = assigned(day.date, team, role)}
                  {@const open = result.open.find(
                    (o) => o.date === day.date && o.team === team && o.role === role
                  )}
                  {@const selectId = `post-${day.date}-${team}-${role}`}
                  <div>
                    <dt>
                      <label class="font-semibold text-brand-900" for={selectId}>{role}</label>
                    </dt>
                    <dd class="mt-1">
                      <span class="hidden print:inline"
                        >{current ? name(current.personId) : '— offen —'}</span
                      >
                      <div class="flex items-center gap-2 print:hidden">
                        <select
                          id={selectId}
                          class="min-w-0 flex-1 rounded-md border px-2 py-1 {current
                            ? 'border-neutral-300'
                            : 'border-[var(--color-dpsg-red)] bg-[#f7e3e5]'}"
                          value={current?.personId ?? ''}
                          onchange={(event) =>
                            setPost(day.date, team, role, event.currentTarget.value)}
                        >
                          <option value="">— offen —</option>
                          {#each candidates(day.date, team, role) as option (option.id)}
                            <option value={option.id}>{option.label}</option>
                          {/each}
                        </select>
                        {#if current}
                          <button
                            type="button"
                            class="shrink-0 rounded-full border px-2 py-1 text-xs font-semibold {current.fixed
                              ? 'border-brand-800 bg-[var(--color-brand-800)] text-white'
                              : 'border-[var(--color-brand-300)] bg-white text-brand-900'}"
                            aria-pressed={current.fixed}
                            title="Fixierte Posten bleiben beim Neuberechnen"
                            onclick={() => toggleFixed(current)}
                          >
                            📌<span class="sr-only"> {role} fixiert</span>
                          </button>
                        {/if}
                      </div>
                      {#if open}
                        <p class="mt-1 text-xs text-[var(--color-dpsg-red)]">
                          {OPEN_REASON_LABELS[open.reason]}
                        </p>
                      {/if}
                    </dd>
                  </div>
                {/each}
              </dl>
            </section>
          {/each}
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <section class="surface p-3 text-sm" aria-labelledby="kitchen-{day.date}">
            <h3 id="kitchen-{day.date}" class="font-semibold text-brand-900">
              Küche <span class="font-normal text-neutral-700">({kitchen.length})</span>
            </h3>
            {#if kitchen.length === 0}
              <p class="text-neutral-700">Niemand.</p>
            {:else}
              <ul class="mt-1 flex flex-wrap gap-x-3">
                {#each kitchen as a (a.personId)}
                  <li>{name(a.personId)}</li>
                {/each}
              </ul>
            {/if}
          </section>
          <section class="surface p-3 text-sm print:hidden" aria-labelledby="idle-{day.date}">
            <h3 id="idle-{day.date}" class="font-semibold text-brand-900">
              Ohne Aufgabe <span class="font-normal text-neutral-700">({idle.length})</span>
            </h3>
            <p class="text-xs text-neutral-700">
              Gemeldet, aber in keinem Team gebraucht und nicht für Küche gemeldet – Reserve für
              Ausfälle.
            </p>
            {#if idle.length > 0}
              <ul class="mt-1 space-y-0.5">
                {#each idle as personId (personId)}
                  <li>
                    {name(personId)}
                    <span class="text-neutral-700"
                      >({(personById.get(personId)?.availability[day.date] ?? []).join(', ')})</span
                    >
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>
      </section>
    {/each}

    {#if workload.length > 0}
      <section aria-labelledby="workload-heading" class="surface p-4 text-sm print:hidden">
        <h2 id="workload-heading" class="font-semibold text-brand-900">Einsätze pro Person</h2>
        <p class="text-xs text-neutral-700">Tage in einem Team, ohne Küche.</p>
        <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {#each workload as entry (entry.name)}
            <li>
              {entry.name}: <span class="font-semibold tabular-nums">{entry.count}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  @media print {
    .einteilung-day + .einteilung-day {
      break-before: page;
    }
  }
</style>
