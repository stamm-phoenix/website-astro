<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { ApiError, sendApi } from '../lib/api';
  import { authStore, isOwnName } from '../lib/authStore.svelte';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import { HELPER_ROLES, KITCHEN } from '../lib/nikolausEinteilung';
  import type { HelperRole } from '../lib/nikolausEinteilung';
  import type { StaffNikolausHelfendeData, StaffNikolausHelper } from '../lib/types';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import TagInput from './pflege/TagInput.svelte';

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
  let busy = $state(false);
  let error = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});
  let notice = $state<{ text: string; kind: 'success' | 'warning' | 'error' } | null>(null);

  const ROLE_SHORT: Record<HelperRole, string> = {
    Nikolaus: 'Nikolaus',
    Krampus: 'Krampus',
    'Fahrer*in': 'Fahrer*in',
    Engerl: 'Engerl',
    Küche: 'Küche',
  };

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
    error = null;
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
    error = null;
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
    if (!form) return;
    busy = true;
    error = null;
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
      if (err instanceof ApiError) {
        error = err.message;
        fieldErrors = err.fields ?? {};
      } else {
        error = 'Speichern fehlgeschlagen. Bitte versuche es erneut.';
      }
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!form?.id) return;
    if (!confirm(`${form.name} wirklich löschen? Die Einteilung dieser Person wird mitgelöscht.`)) {
      return;
    }
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
      error = err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen.';
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
    <div class="overflow-x-auto">
      <table class="w-full min-w-[40rem] text-left text-sm">
        <caption class="sr-only">Helfende mit ihren Posten pro Tag und Tags</caption>
        <thead class="border-b-2 border-neutral-300 text-neutral-700">
          <tr>
            <th scope="col" class="px-3 py-2 font-semibold">Name</th>
            {#each data.days as day (day.date)}
              <th scope="col" class="px-3 py-2 font-semibold">{formatShortDate(day.date)}</th>
            {/each}
            <th scope="col" class="px-3 py-2 font-semibold">Tags</th>
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
                {#if isOwnName(authStore.principal, person.name)}
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
                          {ROLE_SHORT[role]}
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
                      <span aria-hidden="true">+</span><span class="sr-only">positiv:</span>
                      {tag}
                    </li>
                  {/each}
                  {#each person.negativeTags as tag (tag)}
                    <li class="font-semibold text-danger">
                      <span aria-hidden="true">−</span><span class="sr-only">negativ:</span>
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
    <h2 id="helfende-coverage-heading" class="font-serif text-xl font-semibold text-brand-900">
      Meldungen pro Tag und Posten
    </h2>
    <p class="text-xs text-neutral-700">
      Gebraucht wird pro Team je eine Person pro Posten. Wer sich für mehrere Posten meldet, zählt
      bei jedem mit.
    </p>
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
                <span class="font-normal text-neutral-700">({day.teams} Teams)</span></th
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
  {busy}
  {error}
  onsubmit={save}
  onclose={() => (form = null)}
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
      <legend class="form-label">Posten pro Tag</legend>
      <p class="text-xs text-neutral-700">
        Pro Tag übernimmt jede Person höchstens einen Posten. Mehrere Kreuze heißen „eines davon“.
      </p>
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
      label="Positive Tags"
      optional
      hint="Wenn möglich ins Team von Familien mit diesen Tags, z. B. „Jupfis“."
      error={fieldErrors.positiveTags}
    >
      {#snippet children(attrs)}
        <TagInput
          id={attrs.id}
          tags={form!.positiveTags}
          suggestions={data.tags}
          tone="positive"
          describedBy={attrs['aria-describedby']}
          invalid={!!fieldErrors.positiveTags}
          onchange={(tags) => (form!.positiveTags = tags)}
        />
      {/snippet}
    </FormField>

    <FormField
      id="helper-negative-tags"
      label="Negative Tags"
      optional
      hint="Nie ins Team von Familien mit diesen Tags, z. B. die eigene Stufe."
      error={fieldErrors.negativeTags}
    >
      {#snippet children(attrs)}
        <TagInput
          id={attrs.id}
          tags={form!.negativeTags}
          suggestions={data.tags}
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

  {#snippet actions()}
    {#if form?.id}
      <ActionButton variant="danger" type="button" disabled={busy} onclick={remove}
        >Löschen</ActionButton
      >
    {/if}
  {/snippet}
</EditDialog>
