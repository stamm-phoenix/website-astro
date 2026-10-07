<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import StatusLabel from './ui/StatusLabel.svelte';
  import FormField from './pflege/FormField.svelte';
  import ReloadButton from './pflege/ReloadButton.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import { ApiError, sendApi } from '../lib/api';
  import { nikolausSteuerung } from '../lib/pflegeStore.svelte';
  import { guardUnsavedChanges } from '../lib/unsavedChanges';
  import { NIKOLAUS_SLOT_MINUTES, NIKOLAUS_TEAMS, formatNikolausDate } from '../lib/nikolausConfig';
  import type { NikolausSettings } from '../lib/nikolausConfig';
  import type {
    NikolausAuditEntry,
    NikolausCleanupScope,
    StaffNikolausSteuerung,
  } from '../lib/types';

  interface DayForm {
    /** Stable key for the list while dates are being edited. */
    key: number;
    date: string;
    start: string;
    end: string;
    teams: number;
  }

  interface Form {
    publicActive: boolean;
    staffActive: boolean;
    maintenance: boolean;
    pendingHoldMinutes: string;
    changeDeadlineHours: string;
    days: DayForm[];
    baseName: string;
    baseLat: string;
    baseLon: string;
    postalCodes: string;
    farDistanceKm: string;
  }

  const store = nikolausSteuerung.state;

  let form = $state<Form | null>(null);
  /** Version the form was filled from. */
  let etag = $state('');
  let errors = $state<Record<string, string>>({});
  let conflicts = $state<string[]>([]);
  let saving = $state(false);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  let nextKey = 0;

  // Deleting
  let deleting = $state<NikolausCleanupScope | null>(null);
  let confirmation = $state('');
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);

  // Geocoding reservation
  let releaseConfirmed = $state(false);
  let releaseBusy = $state(false);

  const data = $derived(store.data);
  const dirty = $derived(
    form !== null && data !== null && canonical(toSettings(form)) !== canonical(data.settings)
  );

  /** Settings as text with a fixed order of keys, to tell whether the form was changed. */
  function canonical(s: NikolausSettings): string {
    return JSON.stringify([
      s.publicActive,
      s.staffActive,
      s.maintenance,
      s.pendingHoldMinutes,
      s.changeDeadlineHours,
      [...s.days]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => [day.date, day.start, day.end, day.teams]),
      [s.area.base.name, s.area.base.lat, s.area.base.lon],
      s.area.servicePostalCodes,
      s.area.farDistanceKm,
    ]);
  }

  $effect(() => {
    untrack(() => nikolausSteuerung.load());
  });

  // Fill the form from the loaded settings, unless the user is editing
  $effect(() => {
    const current = data;
    if (!current) return;
    untrack(() => {
      if (form && dirty && etag === current.etag) return;
      if (!form || !dirty) fill(current);
    });
  });

  $effect(() => guardUnsavedChanges(() => dirty));

  function fill(current: StaffNikolausSteuerung): void {
    const s = current.settings;
    etag = current.etag;
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
    };
    errors = {};
    conflicts = [];
  }

  function toNumber(value: string): number {
    return value.trim() === '' ? Number.NaN : Number(value.replace(',', '.'));
  }

  function toSettings(f: Form): NikolausSettings {
    return {
      publicActive: f.publicActive,
      pendingHoldMinutes: toNumber(f.pendingHoldMinutes),
      changeDeadlineHours: toNumber(f.changeDeadlineHours),
      days: [...f.days]
        .map(({ date, start, end, teams }) => ({ date, start, end, teams }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      area: {
        base: { name: f.baseName.trim(), lat: toNumber(f.baseLat), lon: toNumber(f.baseLon) },
        servicePostalCodes: f.postalCodes
          .split(/[\s,;]+/)
          .map((code) => code.trim())
          .filter(Boolean),
        farDistanceKm: toNumber(f.farDistanceKm),
      },
      staffActive: f.staffActive,
      maintenance: f.maintenance,
    };
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

  function slotCount(day: DayForm): number {
    const [sh, sm] = day.start.split(':').map(Number);
    const [eh, em] = day.end.split(':').map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    return Number.isFinite(minutes) && minutes > 0
      ? Math.floor(minutes / NIKOLAUS_SLOT_MINUTES)
      : 0;
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!form) return;
    saving = true;
    errors = {};
    conflicts = [];
    message = null;
    try {
      const view = await sendApi<StaffNikolausSteuerung>(
        'PUT',
        '/intern/pflege/nikolaus-steuerung',
        {
          etag,
          settings: toSettings(form),
        }
      );
      store.data = view;
      fill(view);
      messageKind = 'success';
      message =
        'Gespeichert. Änderungen an Anmeldung, Tagen und Gebiet erscheinen auf den öffentlichen Seiten nach dem Neubau in etwa 5 bis 10 Minuten.';
    } catch (error: unknown) {
      messageKind = 'error';
      if (error instanceof ApiError) {
        if (error.code === 'SETTINGS_CONFLICT' && error.fields?.conflicts) {
          conflicts = error.fields.conflicts.split('\n');
        } else if (error.fields) {
          errors = error.fields;
        }
        message = error.message;
      } else {
        message = 'Speichern fehlgeschlagen. Bitte prüfe deine Verbindung.';
      }
    } finally {
      saving = false;
    }
  }

  function startDelete(scope: NikolausCleanupScope): void {
    deleting = scope;
    confirmation = '';
    deleteError = null;
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting || !data) return;
    deleteBusy = true;
    deleteError = null;
    try {
      const result = await sendApi<{ view: StaffNikolausSteuerung }>(
        'POST',
        '/intern/pflege/nikolaus-steuerung/loeschen',
        { scope: deleting, confirmation }
      );
      store.data = result.view;
      messageKind = 'success';
      message =
        deleting === 'bookings'
          ? 'Alle Anmeldungen und die Dispo sind gelöscht.'
          : 'Alle Helfenden und die Einteilung sind gelöscht.';
      deleting = null;
    } catch (error: unknown) {
      deleteError =
        error instanceof ApiError
          ? (error.fields?.confirmation ?? error.message)
          : 'Löschen fehlgeschlagen. Bitte prüfe deine Verbindung.';
    } finally {
      deleteBusy = false;
    }
  }

  async function releaseGeocoding(): Promise<void> {
    if (!data?.geocoding.owner) return;
    releaseBusy = true;
    try {
      store.data = await sendApi<StaffNikolausSteuerung>(
        'POST',
        '/intern/pflege/nikolaus-steuerung/geocoding',
        { owner: data.geocoding.owner, confirmedStopped: releaseConfirmed }
      );
      releaseConfirmed = false;
      messageKind = 'success';
      message = 'Die Sperre der Adresssuche ist gelöst.';
    } catch (error: unknown) {
      messageKind = 'error';
      message =
        error instanceof ApiError
          ? (error.fields?.confirmedStopped ?? error.message)
          : 'Lösen fehlgeschlagen. Bitte prüfe deine Verbindung.';
    } finally {
      releaseBusy = false;
    }
  }

  const dateTime = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  });

  const FIELD_LABELS: Record<string, string> = {
    publicActive: 'Online-Anmeldung',
    staffActive: 'Nikolausverwaltung',
    maintenance: 'Wartungsmodus',
    pendingHoldMinutes: 'Reservierungsdauer',
    changeDeadlineHours: 'Änderungsfrist',
    days: 'Besuchstage',
    area: 'Einsatzgebiet',
  };

  const SWITCH_FIELDS = new Set(['publicActive', 'staffActive', 'maintenance']);

  function describe(entry: NikolausAuditEntry): string {
    if (entry.action === 'settings') {
      const changes = (entry.details.changes ?? {}) as Record<string, { to: unknown }>;
      return Object.entries(changes)
        .map(([field, change]) =>
          SWITCH_FIELDS.has(field)
            ? `${FIELD_LABELS[field]} ${change.to ? 'an' : 'aus'}`
            : `${FIELD_LABELS[field] ?? field} geändert`
        )
        .join(', ');
    }
    const deleted = (entry.details.deleted ?? {}) as Record<string, number>;
    if (entry.action === 'delete-bookings') return `${deleted.bookings ?? 0} Anmeldungen gelöscht`;
    if (entry.action === 'delete-helpers') return `${deleted.helpers ?? 0} Helfende gelöscht`;
    if (entry.action === 'geocoding-release') return 'Sperre der Adresssuche gelöst';
    return entry.action;
  }

  function formatDay(date: string | null): string {
    return date ? formatNikolausDate(date) : '–';
  }
</script>

<div class="space-y-8">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <StatusNotice {message} kind={messageKind} class="min-w-0 flex-1" popup />
    <ReloadButton resource={nikolausSteuerung} />
  </div>

  {#if !data && store.loading}
    <div role="status" aria-live="polite" class="space-y-4">
      <span class="sr-only">Einstellungen werden geladen …</span>
      <div class="skeleton-element h-40 rounded-[var(--radius-lg)]"></div>
      <div class="skeleton-element h-64 rounded-[var(--radius-lg)]"></div>
    </div>
  {:else if !data}
    <p class="border-l-2 border-danger py-1 pl-3 text-sm text-danger" role="alert">
      {store.error ?? 'Die Einstellungen konnten nicht geladen werden.'}
    </p>
  {:else if form}
    {#if data.cleanup.due}
      <section class="surface border-l-4! border-l-danger! p-5" aria-labelledby="due-heading">
        <h2 id="due-heading" class="text-lg font-semibold text-danger">Löschfrist erreicht</h2>
        <p class="mt-1 text-sm text-neutral-800">
          Der letzte Besuch war am {formatDay(data.cleanup.lastVisit)}. Laut Datenschutzerklärung
          müssen die Daten seit dem {formatDay(data.cleanup.deleteBy)} gelöscht sein. Bitte unten unter
          „Daten löschen“ löschen.
        </p>
      </section>
    {/if}

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
                Zeigt die Module Anmeldungen, Dispo, Fahrt und Helfende im Leitendenbereich. Aus:
                Nur diese Steuerung bleibt erreichbar.
              </span>
            </span>
          </label>
          <label class="flex gap-3">
            <input type="checkbox" class="mt-1" bind:checked={form.maintenance} />
            <span>
              <span class="font-semibold text-brand-900">Wartungsmodus</span>
              <span class="block text-sm text-neutral-700">
                Stoppt sofort alle Änderungen an Nikolaus-Daten, von Familien wie im
                Leitendenbereich. Lesen bleibt möglich. Nur für Störungen.
              </span>
            </span>
          </label>
        </div>
        {#if form.maintenance && !data.settings.maintenance}
          <p class="mt-4 border-l-2 border-warning py-1 pl-3 text-sm text-warning">
            Nach dem Speichern werden alle Änderungen abgelehnt, bis der Wartungsmodus wieder aus
            ist.
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

      <div class="flex flex-wrap items-center gap-4">
        <ActionButton
          variant="primary"
          type="submit"
          disabled={saving || !dirty}
          aria-busy={saving}
        >
          {saving ? 'Wird gespeichert …' : 'Einstellungen speichern'}
        </ActionButton>
        {#if dirty}
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

    <section class="surface p-5 md:p-6" aria-labelledby="cleanup-heading">
      <h2 id="cleanup-heading" class="font-serif text-xl font-bold text-brand-900">
        Daten löschen
      </h2>
      <p class="mt-1 text-sm text-neutral-800">
        Nach dem Nikolausdienst werden die Daten einen Kalendermonat nach dem letzten Besuch
        gelöscht (Datenschutzerklärung).
        {#if data.cleanup.deleteBy}
          Letzter Besuch: <strong>{formatDay(data.cleanup.lastVisit)}</strong>, löschen bis
          <strong>{formatDay(data.cleanup.deleteBy)}</strong>.
        {:else}
          Es gibt noch keinen bestätigten Besuch.
        {/if}
        Gelöscht wird endgültig; eine Wiederherstellung ist nur noch sieben Tage lang aus der Sicherung
        der Datenbank möglich.
      </p>

      <ul class="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {#each [{ scope: 'bookings', title: 'Anmeldungen', text: `${data.cleanup.bookings} Anmeldungen der Familien mit Adressen, ${data.cleanup.dispoVisits} geplante Besuche der Dispo und die gespeicherten Ortsangaben der Adresssuche.`, count: data.cleanup.bookings + data.cleanup.dispoVisits }, { scope: 'helpers', title: 'Helfende', text: `${data.cleanup.helpers} Helfende mit Verfügbarkeiten und Tags, ${data.cleanup.assignments} Einträge der Einteilung.`, count: data.cleanup.helpers }] as item (item.scope)}
          {@const scope = item.scope as NikolausCleanupScope}
          <li class="py-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="font-semibold text-brand-900">{item.title}</h3>
                <p class="text-sm text-neutral-700">{item.text}</p>
              </div>
              {#if deleting !== scope}
                <ActionButton
                  variant="danger"
                  type="button"
                  disabled={item.count === 0 || deleting !== null}
                  onclick={() => startDelete(scope)}
                >
                  {item.title} löschen …
                </ActionButton>
              {/if}
            </div>
            {#if deleting === scope}
              <div
                class="mt-4 border-l-4 border-danger pl-4"
                role="group"
                aria-labelledby="delete-{scope}-warning"
              >
                <p id="delete-{scope}-warning" class="text-sm font-semibold text-danger">
                  Achtung: Das löscht {item.text.charAt(0).toLowerCase() + item.text.slice(1)} Das lässt
                  sich nicht rückgängig machen.
                  {#if !data.cleanup.due}
                    Die Löschfrist ist noch nicht erreicht.
                  {/if}
                </p>
                <FormField
                  id="delete-{scope}-confirmation"
                  label={`Zur Bestätigung „${data.confirmations[scope]}“ eintippen`}
                  error={deleteError ?? undefined}
                  class="mt-3 max-w-md"
                >
                  {#snippet children(attrs)}
                    <input
                      {...attrs}
                      type="text"
                      autocomplete="off"
                      class="form-input"
                      bind:value={confirmation}
                    />
                  {/snippet}
                </FormField>
                <div class="mt-3 flex flex-wrap gap-3">
                  <ActionButton
                    variant="danger"
                    type="button"
                    disabled={deleteBusy || confirmation.trim() !== data.confirmations[scope]}
                    aria-busy={deleteBusy}
                    onclick={() => void confirmDelete()}
                  >
                    {deleteBusy ? 'Wird gelöscht …' : `${item.title} endgültig löschen`}
                  </ActionButton>
                  <ActionButton
                    variant="secondary"
                    type="button"
                    disabled={deleteBusy}
                    onclick={() => (deleting = null)}
                  >
                    Abbrechen
                  </ActionButton>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>

    <section class="surface p-5 md:p-6" aria-labelledby="geocoding-heading">
      <h2 id="geocoding-heading" class="font-serif text-xl font-bold text-brand-900">
        Adresssuche
      </h2>
      {#if data.geocoding.owner}
        <p class="mt-1 text-sm text-neutral-800">
          <StatusLabel tone="warning" label="Gesperrt" />
          Eine Adresssuche läuft seit
          {data.geocoding.startedAt
            ? dateTime.format(new Date(data.geocoding.startedAt))
            : 'unbekannt'}. Normalerweise dauert sie Sekunden. Hängt sie länger als ein paar
          Minuten, findet keine Adresse mehr ihren Ort; dann die Sperre lösen.
        </p>
        <label class="mt-3 flex gap-3 text-sm">
          <input type="checkbox" class="mt-1" bind:checked={releaseConfirmed} />
          Die Suche läuft seit mehr als zehn Minuten, es hängt also kein Vorgang mehr daran.
        </label>
        <div class="mt-3">
          <ActionButton
            variant="secondary"
            type="button"
            disabled={!releaseConfirmed || releaseBusy}
            aria-busy={releaseBusy}
            onclick={() => void releaseGeocoding()}
          >
            {releaseBusy ? 'Wird gelöst …' : 'Sperre lösen'}
          </ActionButton>
        </div>
      {:else}
        <p class="mt-1 text-sm text-neutral-800">
          <StatusLabel tone="success" label="Frei" /> Keine Adresssuche läuft gerade.
        </p>
      {/if}
    </section>

    <section aria-labelledby="log-heading">
      <h2 id="log-heading" class="font-serif text-xl font-bold text-brand-900">Protokoll</h2>
      {#if data.log.length}
        <ul class="mt-3 divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
          {#each data.log as entry (entry.id)}
            <li class="flex flex-wrap gap-x-4 gap-y-1 py-2">
              <span class="tabular-nums text-neutral-700"
                >{dateTime.format(new Date(entry.at))}</span
              >
              <span class="text-neutral-700">{entry.actor}</span>
              <span class="text-neutral-900">{describe(entry)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-2 text-sm text-neutral-700">Noch keine Änderungen.</p>
      {/if}
    </section>
  {/if}
</div>
