<script lang="ts">
  import PlanToolbar from './nikolaus/PlanToolbar.svelte';
  import PinToggle from './nikolaus/PinToggle.svelte';
  import { createPlanEditor } from '../lib/planEditor.svelte';
  import { untrack } from 'svelte';
  import { ApiError, errorMessage, fetchApi, sendApi } from '../lib/api';
  import { confirmAction } from '../lib/confirm';
  import FilterTabs from './ui/FilterTabs.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import StatusLabel from './ui/StatusLabel.svelte';

  import { NIKOLAUS_TEAMS } from '../lib/nikolausConfig';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import {
    KITCHEN,
    MAX_TEAMS_PER_DAY,
    OPEN_REASON_LABELS,
    REQUIRED_ROLES,
    TEAM_ROLES,
    completeEinteilung,
    conflictingTags,
    readyTeams,
    solveEinteilung,
    teamCapacity,
  } from '../lib/nikolausEinteilung';
  import type {
    EinteilungAssignment,
    EinteilungDay,
    EinteilungPerson,
    EinteilungProblem,
    TeamRole,
  } from '../lib/nikolausEinteilung';
  import type {
    StaffNikolausEinteilungData,
    StaffNikolausEinteilungRow,
    StaffNikolausHelper,
    StaffNikolausSteuerung,
  } from '../lib/types';
  import { einteilungStore, fetchEinteilung } from '../lib/nikolausHelfendeStore.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  interface Props {
    data: StaffNikolausEinteilungData;
    /** Whether the draft has changes that are not saved yet. */
    dirty?: boolean;
  }

  let { data, dirty = $bindable(false) }: Props = $props();

  /** Team posts only; kitchen and idle persons are derived. */
  let teamAssignments = $state<EinteilungAssignment[]>([]);

  const editor = createPlanEditor({
    dirty: () => dirty,
    field: 'assignments',
    conflictMessage:
      'Die Einteilung wurde inzwischen von jemand anderem geändert. Bitte neu laden – deine Änderungen gehen dabei verloren.',
    saveError:
      'Die Einteilung wurde nicht gespeichert. Dein Entwurf ist noch da. Tippe noch einmal auf „Speichern“.',
  });

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

  /**
   * Teams per day to plan with, while trying out another number than the Steuerung offers.
   * Only days that differ are listed.
   */
  let trial = $state<Record<string, number>>({});
  /** Set while the Steuerung takes over a number, so the draft survives the reload. */
  let keepDraft = false;
  let applying = $state<string | null>(null);

  function teamsOf(day: EinteilungDay): number {
    return trial[day.date] ?? day.teams.length;
  }

  /** The days with the tried number of teams; added teams have no families yet. */
  const plannedDays = $derived<EinteilungDay[]>(
    data.days.map((day) => {
      const count = teamsOf(day);
      if (count === day.teams.length) return day;
      const teams = NIKOLAUS_TEAMS.slice(0, count).map((team) => team.name);
      const familyTags = day.familyTags
        ? Object.fromEntries(teams.map((team) => [team, day.familyTags?.[team] ?? []]))
        : null;
      return { ...day, teams, familyTags };
    })
  );
  const tryingMore = $derived(data.days.some((day) => teamsOf(day) > day.teams.length));

  const problem = $derived<EinteilungProblem>({
    persons: data.persons.map(toPerson),
    days: plannedDays,
  });
  /** Per day: how many teams the helpers of the day could staff at most. */
  const capacity = $derived(
    Object.fromEntries(data.days.map((day) => [day.date, teamCapacity(problem.persons, day.date)]))
  );
  const personById = $derived(new Map(data.persons.map((p) => [p.id, p])));
  const result = $derived(completeEinteilung(problem, teamAssignments));
  const ready = $derived(readyTeams(problem.days, teamAssignments));

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
      if (keepDraft) {
        keepDraft = false;
        return;
      }
      editor.state.conflict = false;
      if (current.rows.length === 0 && current.persons.length > 0) {
        teamAssignments = teamOnly(solveEinteilung(problem).assignments);
        dirty = true;
        editor.state.notice = {
          text: 'Vorschlag berechnet – noch nicht gespeichert.',
          kind: 'warning',
        };
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
    editor.state.notice = { text: 'Neu berechnet – noch nicht gespeichert.', kind: 'warning' };
  }

  function teamsText(count: number): string {
    return `${count} ${count === 1 ? 'Team' : 'Teams'}`;
  }

  function visitsText(count: number): string {
    return `${count} ${count === 1 ? 'Besuch' : 'Besuche'}`;
  }

  function withoutTrial(date: string): Record<string, number> {
    return Object.fromEntries(Object.entries(trial).filter(([key]) => key !== date));
  }

  /** Plans a day with another number of teams; posts of dropped teams are freed. */
  function tryTeams(date: string, count: number): void {
    const official = data.days.find((day) => day.date === date)?.teams.length ?? count;
    const rest = withoutTrial(date);
    trial = count === official ? rest : { ...rest, [date]: count };
    // Only this day is planned again; pinned posts of kept teams stay
    const kept = NIKOLAUS_TEAMS.slice(0, count).map((team) => team.name);
    const others = teamAssignments.filter((a) => a.date !== date);
    const pinned = teamAssignments.filter(
      (a) => a.date === date && a.fixed && kept.includes(a.team)
    );
    const solved = solveEinteilung({ ...problem, fixed: [...others, ...pinned] }).assignments;
    teamAssignments = [
      ...others,
      ...pinned,
      ...teamOnly(solved).filter((a) => a.date === date && !a.fixed),
    ];
    dirty = true;
    editor.state.notice = {
      text: `Mit ${teamsText(count)} am ${formatShortDate(date)} neu berechnet – noch nicht gespeichert.`,
      kind: 'warning',
    };
  }

  /** Writes the tried number of teams of a day into the Steuerung, after asking. */
  async function applyTeams(date: string): Promise<void> {
    const count = trial[date];
    const day = data.days.find((d) => d.date === date);
    if (count === undefined || !day) return;
    const fewer = count < day.teams.length;
    if (
      !(await confirmAction({
        title: `${teamsText(count)} am ${formatShortDate(date)} anbieten?`,
        message: fewer
          ? `Bisher ${day.teams.length === 1 ? 'ist es' : 'sind es'} ${teamsText(day.teams.length)}. Familien können dann pro Termin nur noch ${visitsText(count)} buchen. Schon gebuchte Termine bleiben; passen sie nicht mehr, nennt dir die Steuerung die Termine.`
          : `Bisher ${day.teams.length === 1 ? 'ist es' : 'sind es'} ${teamsText(day.teams.length)}. Familien können dann pro Termin ${visitsText(count)} buchen.`,
        confirmLabel: 'In die Steuerung übernehmen',
        tone: 'neutral',
      }))
    ) {
      return;
    }
    // The day as it is sent; the choice cannot change while the request runs
    const planned = plannedDays.find((d) => d.date === date) ?? day;
    applying = date;
    editor.state.notice = null;
    try {
      const current = await fetchApi<StaffNikolausSteuerung>('/intern/nikolaus/steuerung');
      const settings = {
        ...current.settings,
        days: current.settings.days.map((d) => (d.date === date ? { ...d, teams: count } : d)),
      };
      await sendApi('PUT', '/intern/pflege/nikolaus-steuerung', {
        etag: current.etag,
        settings,
      });
      // The draft stays; the day now comes with the new teams
      trial = withoutTrial(date);
      keepDraft = true;
      einteilungStore.data = {
        ...data,
        days: data.days.map((d) => (d.date === date ? planned : d)),
      };
      editor.state.notice = {
        text: `In der Steuerung ${count === 1 ? 'steht' : 'stehen'} jetzt ${teamsText(count)} am ${formatShortDate(date).replace(/\.$/, '')}.${dirty ? ' Die Einteilung ist noch nicht gespeichert.' : ''}`,
        kind: dirty ? 'warning' : 'success',
      };
    } catch (error) {
      const conflicts =
        error instanceof ApiError && error.fields?.conflicts
          ? ` ${error.fields.conflicts.split('\n').join(' · ')} – erst die Anmeldungen verlegen, die Dispo neu planen und die Einteilung speichern, dann noch einmal übernehmen.`
          : '';
      editor.state.notice = {
        text:
          errorMessage(
            error,
            'Die Teamzahl wurde nicht übernommen. Die Einteilung ist unverändert. Bitte noch einmal versuchen.'
          ) + conflicts,
        kind: 'error',
      };
    } finally {
      applying = null;
    }
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
    editor.state.notice = null;
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
          tags.length > 0 ? `nicht zu Familien mit: ${tags.join(', ')}` : '',
        ].filter(Boolean);
        return {
          id: person.id,
          label: hints.length ? `${person.name} (${hints.join('; ')})` : person.name,
        };
      });
  }

  const TEAM_COUNT_OPTIONS = Array.from({ length: MAX_TEAMS_PER_DAY }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  /** Required posts a team still lacks. */
  function missing(date: string, team: string): string[] {
    return REQUIRED_ROLES.filter((role) => !assigned(date, team, role));
  }

  function name(personId: string): string {
    return personById.get(personId)?.name ?? '?';
  }

  async function save(): Promise<void> {
    await editor.save(async () => {
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
    }, 'Einteilung gespeichert.');
  }

  async function reload(): Promise<void> {
    if (
      !(await editor.confirmReload(
        'Die Änderungen sind noch nicht gespeichert. Trotzdem neu laden?'
      ))
    )
      return;
    // The tried numbers of teams belong to the discarded draft
    trial = {};
    void fetchEinteilung();
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
    <p class="text-sm text-neutral-700">
      Zuerst werden möglichst viele Teams einsatzfähig besetzt: Ein Team kann losfahren, wenn es
      {REQUIRED_ROLES.join(' und ')} hat. Danach kommen Krampus und Engerl, dann wird die Arbeit auf möglichst
      viele Personen verteilt, zuletzt zählen die Wünsche zur Einteilung.
    </p>
    <PlanToolbar
      loading={einteilungStore.loading}
      saveDisabled={!dirty || editor.state.saving || editor.state.conflict || tryingMore}
      saving={editor.state.saving}
      title="Fixierte Posten bleiben"
      onrecalculate={recalculate}
      onreload={reload}
      onsave={save}
    />
  </div>

  <StatusNotice
    message={editor.state.notice?.text ?? null}
    kind={editor.state.notice?.kind}
    class="print:hidden"
  />

  {#if data.persons.length === 0}
    <p class="surface p-6 text-sm text-neutral-800">
      Noch keine Helfenden eingetragen. Bitte zuerst in der Ansicht „Helfende“ Personen anlegen.
    </p>
  {:else}
    {#each plannedDays as day (day.date)}
      {@const official = data.days.find((d) => d.date === day.date)?.teams.length ?? 0}
      {@const cap = capacity[day.date]}
      {@const dayConflicts = result.conflicts.filter((c) => c.date === day.date)}
      {@const kitchen = result.assignments.filter((a) => a.date === day.date && a.team === KITCHEN)}
      {@const idle = result.idle[day.date] ?? []}
      <section aria-labelledby="einteilung-{day.date}" class="einteilung-day space-y-3">
        <h2 id="einteilung-{day.date}" class="font-serif text-2xl font-semibold text-brand-900">
          {formatShortDate(day.date)}
        </h2>

        <div class="surface-muted space-y-3 p-4 text-sm print:hidden">
          <p class="text-neutral-800">
            {#if cap.ready === 0}
              Mit den Gemeldeten kann an diesem Tag kein Team losfahren – dafür braucht es
              {REQUIRED_ROLES.join(' und ')}.
            {:else}
              Ohne Merkmale gerechnet reichen die Gemeldeten für
              <strong
                >{cap.ready >= MAX_TEAMS_PER_DAY ? 'mindestens' : 'höchstens'}
                {cap.ready}
                {cap.ready === 1 ? 'Team' : 'Teams'}</strong
              >, die losfahren können{cap.complete > 0
                ? `, ${cap.complete} davon mit allen vier Posten`
                : ''}.
            {/if}
            {#if official > cap.ready}
              <span class="text-warning">
                Angeboten {official === 1 ? 'ist' : 'sind'}
                {teamsText(official)} – für
                {teamsText(official - cap.ready)} fehlen Leute.
              </span>
            {/if}
          </p>
          <FilterTabs
            variant="segmented"
            showLabel
            label="Teams zum Ausprobieren"
            options={TEAM_COUNT_OPTIONS}
            value={String(day.teams.length)}
            onselect={(value) => tryTeams(day.date, Number(value))}
            disabled={applying !== null}
          />
          {#if day.teams.length !== official}
            <p class="text-warning">
              Ausprobiert: {teamsText(day.teams.length)} statt {official}. Familien buchen weiter
              {visitsText(official)} pro Termin, bis du die Zahl übernimmst.
              {#if day.teams.length > official}
                Speichern geht erst nach dem Übernehmen.
              {/if}
            </p>
            <div class="flex flex-wrap gap-3">
              <ActionButton
                variant="primary"
                type="button"
                disabled={applying !== null}
                onclick={() => applyTeams(day.date)}
              >
                {applying === day.date
                  ? 'Wird übernommen …'
                  : `${teamsText(day.teams.length)} in die Steuerung übernehmen`}
              </ActionButton>
              <ActionButton type="button" onclick={() => tryTeams(day.date, official)}>
                Zurück auf {teamsText(official)}
              </ActionButton>
            </div>
          {/if}
        </div>

        {#if day.familyTags === null}
          <p class="border-l-4 border-warning py-1 pl-3 text-sm text-warning">
            Für diesen Tag ist in der Dispo noch keine Verteilung der Familien auf die Teams
            gespeichert. Die Merkmale der Familien werden erst berücksichtigt, wenn die Dispo
            gespeichert ist.
            <a
              class="font-semibold underline print:hidden"
              href="/leitendenbereich/nikolaus-dispo?tag={day.date}">Zur Dispo dieses Tages</a
            >
          </p>
        {/if}
        {#each dayConflicts as c (c.personId + c.team)}
          <p class="border-l-4 border-danger py-1 pl-3 text-sm font-semibold text-danger">
            <span aria-hidden="true">⚠</span>
            {name(c.personId)} ist in Team {c.team}, soll aber nicht zu Familien mit „{c.tags.join(
              '“, „'
            )}“.
          </p>
        {/each}

        <div
          class="grid gap-x-6 gap-y-8 sm:grid-cols-2 {day.teams.length >= 3
            ? 'xl:grid-cols-4'
            : ''}"
        >
          {#each day.teams as team (team)}
            <section
              aria-labelledby="einteilung-{day.date}-{team}"
              class="border-t-4"
              style:border-top-color={teamColor.get(team)}
            >
              <h3
                id="einteilung-{day.date}-{team}"
                class="border-b border-neutral-200 py-2 font-serif text-lg font-semibold text-brand-900"
              >
                Team {team}
              </h3>
              <p class="pt-1 print:hidden">
                {#if ready.has(`${day.date}|${team}`)}
                  <StatusLabel tone="success" label="Kann losfahren" />
                {:else}
                  <StatusLabel
                    tone="danger"
                    label={`Kann nicht losfahren – es ${missing(day.date, team).length === 1 ? 'fehlt' : 'fehlen'} ${missing(day.date, team).join(' und ')}`}
                  />
                {/if}
              </p>
              <dl class="divide-y divide-neutral-200 text-sm">
                {#each TEAM_ROLES as role (role)}
                  {@const current = assigned(day.date, team, role)}
                  {@const open = result.open.find(
                    (o) => o.date === day.date && o.team === team && o.role === role
                  )}
                  {@const selectId = `post-${day.date}-${team}-${role}`}
                  <div class="py-2.5">
                    <dt>
                      <label class="font-semibold text-brand-900" for={selectId}>{role}</label>
                    </dt>
                    <dd class="mt-1">
                      <span class="hidden print:inline"
                        >{current ? name(current.personId) : '— offen —'}</span
                      >
                      <div class="flex flex-col items-stretch gap-2 print:hidden">
                        <select
                          id={selectId}
                          class="form-input mt-0! min-w-0 flex-1 py-1.5 {current
                            ? 'border-neutral-300'
                            : 'border-danger! bg-danger-soft!'}"
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
                          <PinToggle
                            compact
                            fixed={current.fixed}
                            title="Festgehaltene Posten bleiben beim Neuberechnen erhalten"
                            label={`${role} in Team ${team} am ${formatShortDate(day.date)}`}
                            onclick={() => toggleFixed(current)}
                          />
                        {/if}
                      </div>
                      {#if open}
                        <p class="mt-1 text-xs text-danger">
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

        <div class="grid gap-x-6 gap-y-4 border-t border-neutral-200 pt-4 sm:grid-cols-2">
          <section class="text-sm" aria-labelledby="kitchen-{day.date}">
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
          <section class="text-sm print:hidden" aria-labelledby="idle-{day.date}">
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
      <section
        aria-labelledby="workload-heading"
        class="border-t border-neutral-200 pt-6 text-sm print:hidden"
      >
        <h2 id="workload-heading" class="font-serif text-xl font-semibold text-brand-900">
          Einsätze pro Person
        </h2>
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
