<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';

  import FormField from '../pflege/FormField.svelte';

  import { confirmAction } from '../../lib/confirm';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { nikolausSteuerung } from '../../lib/pflegeStore.svelte';
  import { refreshNikolausStatus } from '../../lib/nikolausStatusStore.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { NIKOLAUS_SLOT_MINUTES, NIKOLAUS_TEAMS } from '../../lib/nikolausConfig';

  import type { StaffNikolausSteuerung } from '../../lib/types';

  import {
    canonical,
    toSettings,
    slotCount,
    dateTime,
    formatDay,
    type Form,
    type DayForm,
  } from '../../lib/nikolausSteuerungForm';
  interface Props {
    data: StaffNikolausSteuerung;
    onnotice: (message: string | null, kind: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();
  const store = nikolausSteuerung.state;
  let form = $state<Form | null>(null);
  /** Version the form was filled from. */
  let etag = $state('');
  let baseline = $state('');
  let versionConflict = $state(false);
  const stale = $derived(versionConflict || (form !== null && etag !== data.etag));
  let errors = $state<Record<string, string>>({});
  let conflicts = $state<string[]>([]);
  let saving = $state(false);
  let nextKey = 0;

  const dirty = $derived(form !== null && canonical(toSettings(form)) !== baseline);

  // Fill the form from the loaded settings, unless the user is editing
  $effect(() => {
    const current = data;
    if (!current) return;
    untrack(() => {
      if (!form || !dirty) fill(current);
    });
  });

  $effect(() => guardUnsavedChanges(() => dirty));

  function fill(current: StaffNikolausSteuerung): void {
    const s = current.settings;
    etag = current.etag;
    baseline = canonical(current.settings);
    versionConflict = false;
    form = {
      publicActive: s.publicActive,
      staffActive: s.staffActive,
      maintenance: s.maintenance,
      pendingHoldMinutes: String(s.pendingHoldMinutes),
      changeDeadlineHours: String(s.changeDeadlineHours),
      days: s.days.map((day) => ({ key: nextKey++, ...day })),
      baseName: s.area.base.name,
      baseLat: String(s.area.base.lat),
      baseLon: String(s.area.base.lon),
      postalCodes: s.area.servicePostalCodes.join(', '),
      farDistanceKm: String(s.area.farDistanceKm),
      contactName: s.dayContact?.name ?? '',
      contactPhone: s.dayContact?.phone ?? '',
    };
    errors = {};
    conflicts = [];
  }

  function addDay(): void {
    if (!form) return;
    const last = [...form.days].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    // The day after the last one, as a default
    const date = last?.date
      ? new Date(Date.parse(`${last.date}T00:00:00Z`) + 24 * 60 * 60_000).toISOString().slice(0, 10)
      : '';
    form.days = [
      ...form.days,
      {
        key: nextKey++,
        date,
        start: last?.start ?? '17:00',
        end: last?.end ?? '21:00',
        teams: last?.teams ?? 2,
      },
    ];
  }

  function removeDay(key: number): void {
    if (form) form.days = form.days.filter((day) => day.key !== key);
  }

  /** Index of a day in the sent (sorted) list, for the field errors of the API. */
  function sentIndex(day: DayForm): number {
    if (!form) return -1;
    return [...form.days].sort((a, b) => a.date.localeCompare(b.date)).indexOf(day);
  }

  function dayError(day: DayForm, field: 'date' | 'start' | 'end' | 'teams'): string | undefined {
    return errors[`days.${sentIndex(day)}.${field}`];
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!form || saving || stale) return;
    saving = true;
    errors = {};
    conflicts = [];
    onnotice(null, 'success');
    const sent = toSettings(form);
    // The staff switches and the maintenance mode work at once; everything else is baked
    const onlySwitches =
      data !== null &&
      canonical({
        ...sent,
        staffActive: data.settings.staffActive,
        maintenance: data.settings.maintenance,
        dayContact: data.settings.dayContact,
      }) === canonical(data.settings);
    try {
      const view = await sendApi<StaffNikolausSteuerung>(
        'PUT',
        '/intern/pflege/nikolaus-steuerung',
        {
          etag,
          settings: sent,
        }
      );
      store.data = view;
      fill(view);
      void refreshNikolausStatus();

      onnotice(
        onlySwitches
          ? 'Gespeichert. Die Änderung gilt ab sofort.'
          : 'Gespeichert. Änderungen an Anmeldung, Tagen und Gebiet erscheinen auf den öffentlichen Seiten nach dem Neubau in etwa 5 bis 10 Minuten.',
        'success'
      );
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        versionConflict = error.status === 409 && error.code !== 'SETTINGS_CONFLICT';
        if (error.code === 'SETTINGS_CONFLICT' && error.fields?.conflicts) {
          conflicts = error.fields.conflicts.split('\n');
        } else if (error.fields) {
          errors = error.fields;
        }
      }
      onnotice(
        errorMessage(
          error,
          'Die Einstellungen wurden nicht gespeichert. Deine Eingaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Einstellungen speichern“.'
        ),
        'error'
      );
    } finally {
      saving = false;
    }
  }
  async function reloadCurrent(): Promise<void> {
    if (saving) return;
    if (
      dirty &&
      !(await confirmAction({
        title: 'Aktuelle Einstellungen laden?',
        message: 'Die aktuelle Fassung ersetzt deine ungespeicherten Einstellungen.',
        confirmLabel: 'Aktuelle Fassung laden',
        cancelLabel: 'Weiter bearbeiten',
      }))
    )
      return;
    saving = true;
    try {
      await nikolausSteuerung.load({ force: true });
      if (store.error || !store.data) {
        onnotice(
          'Die aktuelle Fassung konnte nicht geladen werden. Deine Eingaben sind noch da. Prüfe deine Verbindung und tippe noch einmal auf „Aktuelle Fassung laden“.',
          'error'
        );
        return;
      }
      fill(store.data);
      onnotice('Aktuelle Einstellungen geladen. Du kannst sie jetzt bearbeiten.', 'success');
    } finally {
      saving = false;
    }
  }
</script>

{#if form}
  <form class="space-y-8" novalidate onsubmit={save}>
    <section class="surface p-5 md:p-6" aria-labelledby="switches-heading">
      <h2 id="switches-heading" class="font-serif text-xl font-bold text-brand-900">Schalter</h2>
      <div class="mt-4 space-y-4">
        <label class="flex gap-3">
          <input type="checkbox" class="mt-1" bind:checked={form.publicActive} />
          <span>
            <span class="font-semibold text-brand-900">Online-Anmeldung aktiv</span>
            <span class="block text-sm text-neutral-700">
              Zeigt „Nikolaus“ im Menü, den Banner auf der Startseite und das Formular auf
              /nikolaus. Familien können dann buchen und umbuchen.
            </span>
          </span>
        </label>
        <label class="flex gap-3">
          <input type="checkbox" class="mt-1" bind:checked={form.staffActive} />
          <span>
            <span class="font-semibold text-brand-900">Nikolausverwaltung aktiv</span>
            <span class="block text-sm text-neutral-700">
              Zeigt die Module Anmeldungen, Dispo, Route und Helfende im Leitendenbereich. Aus: Nur
              diese Steuerung bleibt erreichbar.
            </span>
          </span>
        </label>
        <label class="flex gap-3">
          <input type="checkbox" class="mt-1" bind:checked={form.maintenance} />
          <span>
            <span class="font-semibold text-brand-900">Wartungsmodus</span>
            <span class="block text-sm text-neutral-700">
              Stoppt sofort alle Änderungen an Nikolaus-Daten, von Familien wie im Leitendenbereich.
              Lesen bleibt möglich. Nur für Störungen.
            </span>
          </span>
        </label>
      </div>
      {#if form.maintenance && !data.settings.maintenance}
        <p class="mt-4 border-l-2 border-warning py-1 pl-3 text-sm text-warning">
          Nach dem Speichern werden alle Änderungen abgelehnt, bis der Wartungsmodus wieder aus ist.
        </p>
      {/if}
    </section>

    <section class="surface p-5 md:p-6" aria-labelledby="days-heading">
      <h2 id="days-heading" class="font-serif text-xl font-bold text-brand-900">Besuchstage</h2>
      <p class="mt-1 text-sm text-neutral-700">
        Pro Tag Beginn des ersten und Ende des letzten Termins. Termine dauern
        {NIKOLAUS_SLOT_MINUTES} Minuten; die Zahl der Teams ist die Zahl der Buchungen pro Termin. Die
        Online-Buchung eines Tages schließt um Mitternacht davor.
      </p>
      {#if errors.days}
        <p class="mt-2 text-sm text-danger">{errors.days}</p>
      {/if}
      <ul class="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {#each form.days as day (day.key)}
          <li
            class="grid gap-3 py-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,8rem)_auto] sm:items-start"
          >
            <FormField id="day-{day.key}-date" label="Datum" error={dayError(day, 'date')}>
              {#snippet children(attrs)}
                <input {...attrs} type="date" class="form-input" bind:value={day.date} required />
              {/snippet}
            </FormField>
            <FormField id="day-{day.key}-start" label="Von" error={dayError(day, 'start')}>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  type="time"
                  step={NIKOLAUS_SLOT_MINUTES * 60}
                  class="form-input"
                  bind:value={day.start}
                  required
                />
              {/snippet}
            </FormField>
            <FormField id="day-{day.key}-end" label="Bis" error={dayError(day, 'end')}>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  type="time"
                  step={NIKOLAUS_SLOT_MINUTES * 60}
                  class="form-input"
                  bind:value={day.end}
                  required
                />
              {/snippet}
            </FormField>
            <FormField id="day-{day.key}-teams" label="Teams" error={dayError(day, 'teams')}>
              {#snippet children(attrs)}
                <select {...attrs} class="form-input" bind:value={day.teams}>
                  {#each NIKOLAUS_TEAMS.map((_, index) => index + 1) as count (count)}
                    <option value={count}>{count}</option>
                  {/each}
                </select>
              {/snippet}
            </FormField>
            <div class="flex items-center gap-3 sm:pt-7">
              <span class="text-sm text-neutral-700">{slotCount(day)} Termine</span>
              <ActionButton
                variant="secondary"
                type="button"
                onclick={() => removeDay(day.key)}
                aria-label="Tag {day.date ? formatDay(day.date) : 'ohne Datum'} entfernen"
              >
                Entfernen
              </ActionButton>
            </div>
          </li>
        {:else}
          <li class="py-4 text-sm text-neutral-700">Noch keine Besuchstage eingetragen.</li>
        {/each}
      </ul>
      <div class="mt-4">
        <ActionButton variant="secondary" type="button" onclick={addDay}
          >Tag hinzufügen</ActionButton
        >
      </div>
    </section>

    <section class="surface p-5 md:p-6" aria-labelledby="booking-heading">
      <h2 id="booking-heading" class="font-serif text-xl font-bold text-brand-900">Anmeldung</h2>
      <div class="mt-4 grid gap-5 md:grid-cols-2">
        <FormField
          id="pendingHoldMinutes"
          label="Reservierungsdauer (Minuten)"
          hint="So lange hält eine unbestätigte Anmeldung ihren Termin frei."
          error={errors.pendingHoldMinutes}
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="number"
              min="5"
              max="1440"
              class="form-input"
              bind:value={form!.pendingHoldMinutes}
            />
          {/snippet}
        </FormField>
        <FormField
          id="changeDeadlineHours"
          label="Änderungsfrist (Stunden vor dem Termin)"
          hint="Bis dahin können Familien selbst ändern, umbuchen oder absagen."
          error={errors.changeDeadlineHours}
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="number"
              min="0"
              max="336"
              class="form-input"
              bind:value={form!.changeDeadlineHours}
            />
          {/snippet}
        </FormField>
      </div>
    </section>

    <section class="surface p-5 md:p-6" aria-labelledby="area-heading">
      <h2 id="area-heading" class="font-serif text-xl font-bold text-brand-900">Einsatzgebiet</h2>
      <div class="mt-4 grid gap-5 md:grid-cols-3">
        <FormField id="baseName" label="Startpunkt der Teams" error={errors['area.base.name']}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="text"
              maxlength="100"
              class="form-input"
              bind:value={form!.baseName}
            />
          {/snippet}
        </FormField>
        <FormField id="baseLat" label="Breitengrad" error={errors['area.base.lat']}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="text"
              inputmode="decimal"
              class="form-input"
              bind:value={form!.baseLat}
            />
          {/snippet}
        </FormField>
        <FormField id="baseLon" label="Längengrad" error={errors['area.base.lon']}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="text"
              inputmode="decimal"
              class="form-input"
              bind:value={form!.baseLon}
            />
          {/snippet}
        </FormField>
        <FormField
          id="postalCodes"
          label="Postleitzahlen"
          hint="Durch Komma getrennt. Bei anderen Postleitzahlen sehen Familien einen Hinweis."
          error={errors['area.servicePostalCodes']}
          class="md:col-span-2"
        >
          {#snippet children(attrs)}
            <input {...attrs} type="text" class="form-input" bind:value={form!.postalCodes} />
          {/snippet}
        </FormField>
        <FormField
          id="farDistanceKm"
          label="Weit entfernt ab (km)"
          hint="Ab dieser Luftlinie kann der Besuch später und kürzer sein."
          error={errors['area.farDistanceKm']}
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="text"
              inputmode="decimal"
              class="form-input"
              bind:value={form!.farDistanceKm}
            />
          {/snippet}
        </FormField>
      </div>
    </section>

    <section class="surface p-5 md:p-6" aria-labelledby="contact-heading">
      <h2 id="contact-heading" class="font-serif text-xl font-bold text-brand-900">
        Kontakt am Besuchstag
      </h2>
      <p class="mt-1 text-sm text-neutral-700">
        Eine Person für alle Termine, die Familien nur im Notfall anrufen, z. B. wenn sie doch nicht
        zu Hause sind; sonst schreiben sie über das Kontaktformular. Familien sehen Name und Nummer
        erst zwei Stunden vor ihrem Termin auf ihrer Terminseite. Leer lassen, wenn niemand
        angezeigt werden soll.
      </p>
      <div class="mt-4 grid gap-5 md:grid-cols-2">
        <FormField id="contactName" label="Name" optional error={errors['dayContact.name']}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="text"
              autocomplete="off"
              class="form-input"
              bind:value={form!.contactName}
            />
          {/snippet}
        </FormField>
        <FormField
          id="contactPhone"
          label="Handynummer"
          optional
          error={errors['dayContact.phone']}
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="tel"
              autocomplete="off"
              class="form-input"
              bind:value={form!.contactPhone}
            />
          {/snippet}
        </FormField>
      </div>
    </section>

    {#if conflicts.length}
      <div class="border-l-2 border-danger py-1 pl-3 text-sm text-danger" role="alert">
        <p class="font-semibold">Nicht gespeichert: Das passt nicht zu vorhandenen Daten.</p>
        <ul class="mt-1 list-disc pl-5">
          {#each conflicts as conflict (conflict)}
            <li>{conflict}</li>
          {/each}
        </ul>
        <p class="mt-1">Erst die Anmeldungen verlegen oder die Planung anpassen.</p>
      </div>
    {/if}

    {#if stale}<p role="alert" class="border-l-2 border-warning pl-3 text-sm text-warning">
        Die Einstellungen wurden inzwischen geändert. Deine Eingaben sind noch da. Lade die aktuelle
        Fassung, bevor du weiterarbeitest.
      </p>{/if}
    <div class="flex flex-wrap items-center gap-4">
      <ActionButton
        variant="primary"
        type="submit"
        disabled={saving || !dirty || stale}
        aria-busy={saving}
      >
        {saving ? 'Wird gespeichert …' : 'Einstellungen speichern'}
      </ActionButton>
      {#if stale}<ActionButton
          type="button"
          variant="secondary"
          disabled={saving}
          onclick={reloadCurrent}>Aktuelle Fassung laden</ActionButton
        >{/if}
      {#if dirty && !stale}
        <ActionButton
          variant="secondary"
          type="button"
          disabled={saving}
          onclick={() => fill(data!)}
        >
          Änderungen verwerfen
        </ActionButton>
      {/if}
      <p class="text-sm text-neutral-700">
        Zuletzt geändert {dateTime.format(new Date(data.updatedAt))}{data.updatedBy
          ? ` von ${data.updatedBy}`
          : ''}
      </p>
    </div>
  </form>
{/if}
