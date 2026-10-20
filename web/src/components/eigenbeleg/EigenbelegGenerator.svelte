<script lang="ts">
  import { aktionTitles } from '../../lib/campflowFields';
  import { onMount, tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import Panel from '../ui/Panel.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { authStore, fetchPrincipal, getFullName } from '../../lib/authStore.svelte';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { downloadEigenbelegPdf, pdfFileName } from '../../lib/abrechnungPdf';
  import { parseEuroToCent } from '../../lib/belege';
  import { formatEuro, todayIso } from '../../lib/format';
  import { confirmAction } from '../../lib/confirm';
  import { formatDate } from '../../lib/campflowFields';
  import {
    GRUENDE,
    MAX_POSITIONEN,
    ZAHLUNGSARTEN,
    eigenbelegSumme,
    grundText,
    leererEigenbeleg,
    pruefeEigenbeleg,
  } from '../../lib/eigenbeleg';
  import type { Eigenbeleg } from '../../lib/eigenbeleg';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { fetchVorstand, vorstandStore } from '../../lib/vorstandStore.svelte';

  /** Today, refreshed when the page is used again, so it stays right past midnight. */
  let heute = $state(todayIso());
  const HEADING_CLASS = 'font-serif text-lg font-semibold text-brand-900';

  let beleg = $state<Eigenbeleg>(leererEigenbeleg('', todayIso()));
  /** The form as it was when empty or last downloaded: nothing to lose then. */
  let gesichert = $state(JSON.stringify(leererEigenbeleg('', todayIso())));
  let showErrors = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  const fehler = $derived(showErrors ? pruefeEigenbeleg(beleg, heute) : {});
  const summeCent = $derived(eigenbelegSumme(beleg));
  const geaendert = $derived(JSON.stringify(beleg) !== gesichert);

  const aktionSuggestions = $derived(aktionTitles(campflowEventsStore.data ?? []));

  onMount(() => {
    const stopGuard = guardUnsavedChanges(() => geaendert);
    // A page left open overnight would otherwise take today for a date in the future
    const refreshToday = (): void => {
      heute = todayIso();
    };
    window.addEventListener('focus', refreshToday);
    document.addEventListener('visibilitychange', refreshToday);
    return () => {
      stopGuard();
      window.removeEventListener('focus', refreshToday);
      document.removeEventListener('visibilitychange', refreshToday);
    };
  });

  $effect(() => {
    untrack(() => {
      // Only suggestions and the letterhead; the form works without them
      fetchCampflowEvents();
      void fetchVorstand();
      void fetchPrincipal().then(() => {
        const name = authStore.principal ? getFullName(authStore.principal) : null;
        if (!name || beleg.aussteller.trim()) return;
        const leer = JSON.stringify(beleg) === gesichert;
        beleg.aussteller = name;
        if (leer) gesichert = JSON.stringify(beleg);
      });
    });
  });

  function addPosition(): void {
    if (beleg.positionen.length >= MAX_POSITIONEN) return;
    beleg.positionen.push({ beschreibung: '', betrag: '' });
    const index = beleg.positionen.length - 1;
    void tick().then(() => document.getElementById(`eb-position-${index}`)?.focus());
  }

  function removePosition(index: number): void {
    beleg.positionen.splice(index, 1);
    void tick().then(() =>
      document.getElementById(`eb-position-${Math.max(0, index - 1)}`)?.focus()
    );
  }

  async function neuerBeleg(): Promise<void> {
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Neuen Eigenbeleg beginnen?',
        message: 'Eingaben verwerfen und einen neuen Eigenbeleg beginnen?',
        confirmLabel: 'Eingaben verwerfen',
      }))
    ) {
      return;
    }
    heute = todayIso();
    beleg = leererEigenbeleg(beleg.aussteller, heute);
    gesichert = JSON.stringify(beleg);
    showErrors = false;
    error = null;
    notice = null;
  }

  async function download(): Promise<void> {
    heute = todayIso();
    showErrors = true;
    notice = null;
    error = null;
    const result = pruefeEigenbeleg(beleg, heute);
    const first = Object.keys(result)[0];
    if (first) {
      await tick();
      document.getElementById(`eb-${first}`)?.focus();
      return;
    }
    busy = true;
    try {
      if (!vorstandStore.data) await fetchVorstand();
      const art = ZAHLUNGSARTEN.find((z) => z.id === beleg.zahlungsart)?.label ?? '';
      // The PDF has these values, even if the form is changed while it is created
      const snapshot = JSON.stringify(beleg);
      await downloadEigenbelegPdf(
        {
          aussteller: beleg.aussteller.trim(),
          empfaenger: beleg.empfaenger.trim(),
          zahlungsdatum: formatDate(beleg.zahlungsdatum),
          zahlungsart: art,
          anlass: beleg.anlass.trim(),
          positionen: beleg.positionen
            .filter((p) => p.beschreibung.trim() || p.betrag.trim())
            .map((p) => ({
              beschreibung: p.beschreibung.trim(),
              cent: parseEuroToCent(p.betrag) ?? 0,
            })),
          totalCent: summeCent,
          grund: grundText(beleg),
          ort: beleg.ort.trim(),
          datum: formatDate(beleg.datum),
          vorstaende: vorstandStore.data ?? [],
        },
        pdfFileName('Eigenbeleg', beleg.zahlungsdatum, beleg.empfaenger.trim())
      );
      gesichert = snapshot;
      notice =
        'Der Eigenbeleg wurde heruntergeladen. Drucke ihn aus, unterschreibe ihn und reiche ihn wie einen Kassenbeleg unter „Belege“ ein.';
    } catch {
      error = 'Das PDF konnte nicht erstellt werden. Bitte versuche es noch einmal.';
    } finally {
      busy = false;
    }
  }
</script>

<form
  novalidate
  class="space-y-6"
  aria-label="Eigenbeleg"
  onsubmit={(event) => {
    event.preventDefault();
    if (!busy) void download();
  }}
>
  <Panel aria-labelledby="eb-zahlung-titel">
    <h2 id="eb-zahlung-titel" class={HEADING_CLASS}>Zahlung</h2>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <FormField
        id="eb-aussteller"
        label="Ausgelegt von"
        hint="Wer bezahlt hat und unterschreibt"
        error={fehler.aussteller}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="100"
            autocomplete="name"
            bind:value={beleg.aussteller}
          />
        {/snippet}
      </FormField>
      <FormField
        id="eb-empfaenger"
        label="Bezahlt an"
        hint="Geschäft, Firma oder Person"
        error={fehler.empfaenger}
      >
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="120" bind:value={beleg.empfaenger} />
        {/snippet}
      </FormField>
      <FormField id="eb-zahlungsdatum" label="Datum der Zahlung" error={fehler.zahlungsdatum}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            type="date"
            class="form-input"
            max={heute}
            bind:value={beleg.zahlungsdatum}
          />
        {/snippet}
      </FormField>
      <FormField id="eb-zahlungsart" label="Zahlungsart">
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={beleg.zahlungsart}>
            {#each ZAHLUNGSARTEN as art (art.id)}
              <option value={art.id}>{art.label}</option>
            {/each}
          </select>
        {/snippet}
      </FormField>
      <FormField
        id="eb-anlass"
        label="Aktion oder Zweck"
        hint="Aktion aus CampFlow oder z. B. „Gruppenstunde Wölflinge“"
        error={fehler.anlass}
        class="sm:col-span-2"
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="120"
            list="eb-anlass-suggestions"
            autocomplete="off"
            bind:value={beleg.anlass}
          />
          <datalist id="eb-anlass-suggestions">
            {#each aktionSuggestions as title (title)}
              <option value={title}></option>
            {/each}
          </datalist>
        {/snippet}
      </FormField>
    </div>
  </Panel>

  <Panel aria-labelledby="eb-positionen-titel">
    <h2 id="eb-positionen-titel" class={HEADING_CLASS}>Was wurde bezahlt?</h2>
    <p class="mt-1 text-sm text-neutral-700">
      Eine Zeile je Posten, z. B. „Parkgebühr Zeltplatz“ oder „Brennholz, 2 Säcke“.
    </p>
    <ol class="mt-4 space-y-3">
      {#each beleg.positionen as position, index (index)}
        {@const positionFehler = fehler[`position-${index}`]}
        <li class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-start">
          <div>
            <label for="eb-position-{index}" class="sr-only">Posten {index + 1}</label>
            <input
              id="eb-position-{index}"
              class="form-input"
              maxlength="200"
              placeholder="Posten {index + 1}"
              aria-invalid={positionFehler ? 'true' : undefined}
              aria-describedby={positionFehler ? `eb-position-${index}-error` : undefined}
              bind:value={position.beschreibung}
            />
            {#if positionFehler}
              <p id="eb-position-{index}-error" class="mt-1 text-sm text-danger">
                {positionFehler}
              </p>
            {/if}
          </div>
          <div>
            <label for="eb-betrag-{index}" class="sr-only">Betrag Posten {index + 1} in €</label>
            <input
              id="eb-betrag-{index}"
              class="form-input text-right tabular-nums"
              inputmode="decimal"
              placeholder="0,00 €"
              maxlength="12"
              autocomplete="off"
              aria-invalid={positionFehler ? 'true' : undefined}
              bind:value={position.betrag}
            />
          </div>
          {#if beleg.positionen.length > 1}
            <ActionButton
              variant="secondary"
              type="button"
              aria-label="Posten {index + 1} entfernen"
              onclick={() => removePosition(index)}
            >
              Entfernen
            </ActionButton>
          {/if}
        </li>
      {/each}
    </ol>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <ActionButton
        variant="secondary"
        type="button"
        disabled={beleg.positionen.length >= MAX_POSITIONEN}
        onclick={addPosition}
      >
        Posten hinzufügen
      </ActionButton>
      <p class="text-brand-900">
        <span class="font-semibold">Summe</span>
        <span class="ml-2 text-lg font-semibold tabular-nums" data-testid="eigenbeleg-summe">
          {formatEuro(summeCent)}
        </span>
      </p>
    </div>
  </Panel>

  <Panel aria-labelledby="eb-grund-titel">
    <fieldset>
      <legend>
        <h2 id="eb-grund-titel" class={HEADING_CLASS}>Warum gibt es keinen Originalbeleg?</h2>
      </legend>
      <div class="mt-3 space-y-2">
        {#each GRUENDE as grund (grund.id)}
          <label class="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="eb-grund"
              class="mt-1"
              value={grund.id}
              bind:group={beleg.grund}
            />
            <span>{grund.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>
    {#if beleg.grund === 'sonstiges'}
      <FormField id="eb-grundText" label="Grund" error={fehler.grundText} class="mt-3">
        {#snippet children(attrs)}
          <textarea
            {...attrs}
            class="form-input"
            rows="2"
            maxlength="500"
            bind:value={beleg.grundText}></textarea>
        {/snippet}
      </FormField>
    {/if}
  </Panel>

  <Panel aria-labelledby="eb-ausstellung-titel">
    <h2 id="eb-ausstellung-titel" class={HEADING_CLASS}>Ausstellung</h2>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <FormField id="eb-ort" label="Ort" error={fehler.ort}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="80" bind:value={beleg.ort} />
        {/snippet}
      </FormField>
      <FormField id="eb-datum" label="Datum" error={fehler.datum}>
        {#snippet children(attrs)}
          <input {...attrs} type="date" class="form-input" max={heute} bind:value={beleg.datum} />
        {/snippet}
      </FormField>
    </div>
    <p class="mt-4 text-sm text-neutral-700">
      Das PDF kommt auf das Briefpapier des Stammes, mit einer Erklärung über die Zahlung und Zeilen
      für deine Unterschrift und die Bestätigung durch Kasse oder Vorstand. Gespeichert wird nichts:
      Die Eingaben gelten nur, solange diese Seite geöffnet ist.
    </p>

    <StatusNotice class="mt-4" message={notice} />
    <StatusNotice class="mt-4" kind="error" message={error} />
    {#if showErrors && Object.keys(fehler).length > 0}
      <p role="alert" class="mt-4 text-sm text-danger">Bitte ergänze die markierten Angaben.</p>
    {/if}

    <div class="mt-4 flex flex-wrap justify-end gap-2">
      {#if notice}
        <a
          href="/leitendenbereich/belege"
          class="inline-flex items-center px-4 py-2 text-sm font-semibold text-link underline"
        >
          Zu den Belegen
        </a>
      {/if}
      <ActionButton variant="secondary" type="button" disabled={busy} onclick={neuerBeleg}>
        Neuer Eigenbeleg
      </ActionButton>
      <ActionButton variant="primary" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? 'PDF wird erstellt …' : 'Als PDF herunterladen'}
      </ActionButton>
    </div>
  </Panel>
</form>
