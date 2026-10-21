<script lang="ts">
  import type { Notice } from '../lib/status';
  import { fetchHelfende, helfendeStore } from '../lib/nikolausHelfendeStore.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import { ApiError, errorMessage, sendApi } from '../lib/api';
  import { isIch } from '../lib/ichStore.svelte';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import { HELPER_ROLES, KITCHEN } from '../lib/nikolausEinteilung';
  import type { HelperRole } from '../lib/nikolausEinteilung';
  import type { StaffNikolausHelfendeData, StaffNikolausHelper } from '../lib/types';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import TagInput from './pflege/TagInput.svelte';
  import InfoHint from './ui/InfoHint.svelte';
  import type { RescueField } from '../lib/geretteteEingaben';

  interface Props {
    data: StaffNikolausHelfendeData;
    /** Called after a helper was created, changed or deleted. */
    onchanged: () => Promise<void>;
  }

  let { data, onchanged }: Props = $props();

  interface Form {
    id: string | null;
    etag: string;
    name: string;
    availability: Record<string, HelperRole[]>;
    positiveTags: string[];
    negativeTags: string[];
    notes: string;
  }

  let form = $state<Form | null>(null);
  function tagRecovery(field: 'positiveTags' | 'negativeTags', label: string): RescueField {
    return {
      key: `${label}#custom`,
      get: () => JSON.stringify(form?.[field] ?? []),
      describe: (value) => (JSON.parse(value) as string[]).join(', '),
      set(value) {
        try {
          const tags: unknown = JSON.parse(value);
          if (!form || !Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string'))
            return false;
          form[field] = tags;
          return true;
        } catch {
          return false;
        }
      },
    };
  }
  let busy = $state(false);
  let initialTags = $state('');
  const tagsDirty = $derived(
    form !== null && JSON.stringify([form.positiveTags, form.negativeTags]) !== initialTags
  );
  let error = $state<string | null>(null);
  let conflict = $state(false);
  let fieldErrors = $state<Record<string, string>>({});
  let notice = $state<Notice | null>(null);

  /** Volunteers per day and post compared with what is needed (one per team). */
  const coverage = $derived(
    data.days.map((day) => ({
      date: day.date,
      teams: day.teams.length,
      counts: HELPER_ROLES.map((role) => ({
        role,
        count: data.persons.filter((p) => (p.availability[day.date] ?? []).includes(role)).length,
      })),
    }))
  );

  function openNew(): void {
    form = {
      id: null,
      etag: '',
      name: '',
      availability: {},
      positiveTags: [],
      negativeTags: [],
      notes: '',
    };
    initialTags = JSON.stringify([form.positiveTags, form.negativeTags]);
    error = null;
    conflict = false;
    fieldErrors = {};
  }

  function openEdit(person: StaffNikolausHelper): void {
    form = {
      id: person.id,
      etag: person.etag,
      name: person.name,
      availability: Object.fromEntries(
        Object.entries(person.availability).map(([date, roles]) => [date, [...roles]])
      ),
      positiveTags: [...person.positiveTags],
      negativeTags: [...person.negativeTags],
      notes: person.notes,
    };
    initialTags = JSON.stringify([form.positiveTags, form.negativeTags]);
    error = null;
    conflict = false;
    fieldErrors = {};
  }

  function toggleRole(date: string, role: HelperRole, checked: boolean): void {
    if (!form) return;
    const current = form.availability[date] ?? [];
    form.availability[date] = HELPER_ROLES.filter((r) =>
      r === role ? checked : current.includes(r)
    );
  }

  async function save(): Promise<void> {
    if (!form || busy || conflict) return;
    if (!form.name.trim()) {
      fieldErrors = { name: 'Bitte gib den Namen der Person an.' };
      error = null;
      return;
    }
    busy = true;
    error = null;
    conflict = false;
    fieldErrors = {};
    const body = {
      name: form.name,
      availability: form.availability,
      positiveTags: form.positiveTags,
      negativeTags: form.negativeTags,
      notes: form.notes,
      etag: form.etag,
    };
    try {
      if (form.id) await sendApi('PATCH', `/intern/pflege/nikolaus-helfende/${form.id}`, body);
      else await sendApi('POST', '/intern/pflege/nikolaus-helfende', body);
      notice = { text: `${form.name} gespeichert.`, kind: 'success' };
      form = null;
      await onchanged();
    } catch (err: unknown) {
      conflict = err instanceof ApiError && err.status === 409;
      error = conflict
        ? 'Die Person wurde inzwischen geändert. Deine Eingaben sind noch da. Lade die aktuelle Fassung, bevor du weiterarbeitest.'
        : errorMessage(
            err,
            'Die Person wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.'
          );
      if (err instanceof ApiError) fieldErrors = err.fields ?? {};
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!form?.id || busy) return;
    busy = true;
    error = null;
    try {
      await sendApi('DELETE', `/intern/pflege/nikolaus-helfende/${form.id}`, undefined, {
        etag: form.etag,
      });
      notice = { text: `${form.name} gelöscht.`, kind: 'success' };
      form = null;
      await onchanged();
    } catch (err: unknown) {
      conflict = err instanceof ApiError && err.status === 409;
      error = errorMessage(
        err,
        'Die Person wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.'
      );
    } finally {
      busy = false;
    }
  }
  async function reloadCurrent(): Promise<boolean> {
    if (!form?.id || busy) return false;
    const id = form.id;
    busy = true;
    try {
      await fetchHelfende();
      if (helfendeStore.error) {
        error = `${helfendeStore.error} Deine Eingaben sind noch da.`;
        return false;
      }
      const fresh = helfendeStore.data?.persons.find((person) => person.id === id);
      if (!fresh) {
        form = null;
        notice = { text: 'Die Person wurde inzwischen gelöscht.', kind: 'warning' };
        return true;
      }
      openEdit(fresh);
      return true;
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-neutral-700">
      {data.persons.length}
      {data.persons.length === 1 ? 'Person' : 'Personen'} eingetragen.
    </p>
    <ActionButton variant="primary" type="button" onclick={openNew}>Person hinzufügen</ActionButton>
  </div>

  <StatusNotice message={notice?.text ?? null} kind={notice?.kind} popup />

  {#if data.persons.length === 0}
    <p class="surface p-6 text-sm text-neutral-800">Noch niemand eingetragen.</p>
  {:else}
    <p class="text-sm text-neutral-700 md:hidden">Seitlich wischen ›</p>
    <div class="overflow-x-auto">
      <table class="w-full min-w-[40rem] text-left text-sm">
        <caption class="sr-only"
          >Helfende mit ihren Posten pro Tag und Wünschen zur Einteilung</caption
        >
        <thead class="border-b-2 border-neutral-300 text-neutral-700">
          <tr>
            <th scope="col" class="px-3 py-2 font-semibold">Name</th>
            {#each data.days as day (day.date)}
              <th scope="col" class="px-3 py-2 font-semibold">{formatShortDate(day.date)}</th>
            {/each}
            <th scope="col" class="px-3 py-2 font-semibold">Wünsche zur Einteilung</th>
            <th scope="col" class="px-3 py-2 font-semibold"
              ><span class="sr-only">Aktionen</span></th
            >
          </tr>
        </thead>
        <tbody>
          {#each data.persons as person (person.id)}
            <tr class="border-b border-neutral-200 align-top last:border-0">
              <th scope="row" class="px-3 py-3 font-semibold text-brand-900">
                {person.name}
                {#if isIch({ name: person.name })}
                  <span class="font-normal text-neutral-700">(ich)</span>
                {/if}
                {#if person.notes}
                  <span class="mt-0.5 block text-xs font-normal text-neutral-700"
                    >{person.notes}</span
                  >
                {/if}
              </th>
              {#each data.days as day (day.date)}
                <td class="px-3 py-3">
                  {#if (person.availability[day.date] ?? []).length === 0}
                    <span class="text-neutral-500">–</span>
                  {:else}
                    <ul class="flex flex-wrap gap-x-3 gap-y-0.5">
                      {#each person.availability[day.date] as role (role)}
                        <li class="text-neutral-900">
                          {role}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </td>
              {/each}
              <td class="px-3 py-3">
                <ul class="flex flex-wrap gap-x-3 gap-y-0.5">
                  {#each person.positiveTags as tag (tag)}
                    <li class="font-semibold text-success">
                      <span>Bevorzugt:</span>
                      {tag}
                    </li>
                  {/each}
                  {#each person.negativeTags as tag (tag)}
                    <li class="font-semibold text-danger">
                      <span>Nicht zu:</span>
                      {tag}
                    </li>
                  {/each}
                </ul>
              </td>
              <td class="px-3 py-3 text-right">
                <ActionButton
                  variant="secondary"
                  type="button"
                  class="min-h-9 px-3 py-1"
                  onclick={() => openEdit(person)}
                >
                  Bearbeiten<span class="sr-only"> ({person.name})</span>
                </ActionButton>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <section aria-labelledby="helfende-coverage-heading" class="border-t border-neutral-200 pt-6">
    <h2
      id="helfende-coverage-heading"
      class="inline font-serif text-xl font-semibold text-brand-900"
    >
      Meldungen pro Tag und Posten
    </h2>
    <InfoHint
      label="Meldungen pro Tag und Posten"
      text="Gebraucht wird pro Team eine Person pro Posten. Wer sich für mehrere Posten meldet, zählt bei jedem mit."
      class="ml-1"
    />
    <div class="mt-3 overflow-x-auto">
      <table class="w-full min-w-[32rem] text-left text-sm">
        <thead class="border-b-2 border-neutral-300 text-neutral-700">
          <tr>
            <th scope="col" class="py-2 pr-4 font-semibold">Tag</th>
            {#each HELPER_ROLES as role (role)}
              <th scope="col" class="py-2 pr-4 font-semibold">{role}</th>
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-200">
          {#each coverage as day (day.date)}
            <tr>
              <th scope="row" class="py-2 pr-4 font-semibold"
                >{formatShortDate(day.date)}
                <span class="font-normal text-neutral-700"
                  >({day.teams} {day.teams === 1 ? 'Team' : 'Teams'})</span
                ></th
              >
              {#each day.counts as entry (entry.role)}
                <td
                  class="py-2 pr-4 tabular-nums {entry.role !== KITCHEN && entry.count < day.teams
                    ? 'font-semibold text-danger'
                    : ''}"
                >
                  {entry.count}{entry.role !== KITCHEN ? ` / ${day.teams}` : ''}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>

<EditDialog
  open={form !== null}
  title={form?.id ? 'Person bearbeiten' : 'Person hinzufügen'}
  rescueKey={form ? `helfende:${form.id ?? 'neu'}` : undefined}
  rescueVersion={form?.etag}
  rescueFields={[
    tagRecovery('positiveTags', 'Bevorzugt zu Familien mit'),
    tagRecovery('negativeTags', 'Nicht zu Familien mit'),
  ]}
  {busy}
  dirty={tagsDirty}
  {error}
  submitLabel={form?.id ? 'Person speichern' : 'Person hinzufügen'}
  submitDisabled={conflict}
  onreload={conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={() => (form = null)}
  ondelete={form?.id ? remove : undefined}
  deleteTitle={`${form?.name.trim() ?? ''} löschen?`}
  deleteQuestion={`${form?.name} wirklich löschen? Die Einteilung dieser Person wird mitgelöscht.`}
>
  {#if form}
    <FormField id="helper-name" label="Name" error={fieldErrors.name}>
      {#snippet children(attrs)}
        <input
          {...attrs}
          class="form-input"
          autocomplete="off"
          value={form?.name ?? ''}
          oninput={(event) => form && (form.name = event.currentTarget.value)}
        />
      {/snippet}
    </FormField>

    <fieldset>
      <legend class="form-label">Kann übernehmen (pro Tag einen davon)</legend>
      <p class="mt-1 text-xs text-neutral-700 sm:hidden">Seitlich wischen ›</p>
      {#if fieldErrors.availability}
        <p class="mt-1 text-sm text-danger">{fieldErrors.availability}</p>
      {/if}
      <div class="mt-2 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr>
              <th scope="col" class="py-1 pr-2 text-left"><span class="sr-only">Tag</span></th>
              {#each HELPER_ROLES as role (role)}
                <th scope="col" class="px-2 py-1 text-center font-semibold">{role}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.days as day (day.date)}
              <tr>
                <th scope="row" class="py-1 pr-2 text-left font-semibold"
                  >{formatShortDate(day.date)}</th
                >
                {#each HELPER_ROLES as role (role)}
                  <td class="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      class="size-5"
                      aria-label="{role} am {formatShortDate(day.date)}"
                      checked={(form.availability[day.date] ?? []).includes(role)}
                      onchange={(event) => toggleRole(day.date, role, event.currentTarget.checked)}
                    />
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </fieldset>

    <FormField
      id="helper-positive-tags"
      label="Bevorzugt zu Familien mit"
      optional
      error={fieldErrors.positiveTags}
    >
      {#snippet children(attrs)}
        <TagInput
          id={attrs.id}
          tags={form!.positiveTags}
          suggestions={data.tags}
          placeholder="z. B. Jupfis"
          tone="positive"
          describedBy={attrs['aria-describedby']}
          invalid={!!fieldErrors.positiveTags}
          onchange={(tags) => (form!.positiveTags = tags)}
        />
      {/snippet}
    </FormField>

    <FormField
      id="helper-negative-tags"
      label="Nicht zu Familien mit"
      optional
      hint="Gleicher Begriff wie bei der Familie, z. B. die eigene Stufe. Gilt als Nikolaus, Krampus und Engerl, nicht als Fahrer*in."
      error={fieldErrors.negativeTags}
    >
      {#snippet children(attrs)}
        <TagInput
          id={attrs.id}
          tags={form!.negativeTags}
          suggestions={data.tags}
          placeholder="z. B. Wölflinge"
          tone="negative"
          describedBy={attrs['aria-describedby']}
          invalid={!!fieldErrors.negativeTags}
          onchange={(tags) => (form!.negativeTags = tags)}
        />
      {/snippet}
    </FormField>

    <FormField id="helper-notes" label="Bemerkungen" optional error={fieldErrors.notes}>
      {#snippet children(attrs)}
        <textarea
          {...attrs}
          class="form-input"
          rows="2"
          value={form?.notes ?? ''}
          oninput={(event) => form && (form.notes = event.currentTarget.value)}></textarea>
      {/snippet}
    </FormField>
  {/if}
</EditDialog>
