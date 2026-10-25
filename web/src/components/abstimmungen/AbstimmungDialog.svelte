<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import type { AbstimmungDetail, AbstimmungSichtbarkeit } from '../../lib/abstimmungen';
  import type { RescueField } from '../../lib/geretteteEingaben';
  import { MAX_ABSTIMMUNG_OPTIONEN, SICHTBARKEIT_LABELS, terminText } from '../../lib/abstimmungen';

  interface Props {
    open: boolean;
    /** The Abstimmung to change; a new one without. */
    abstimmung?: AbstimmungDetail | null;
    /** After saving, with the ID; the dialog is closed by then. */
    onsaved: (id: number, message: string) => void;
    onclose: () => void;
    /** Deletes the Abstimmung; only offered while editing. */
    ondelete?: () => Promise<void>;
    /** Loads the current version after a conflict. */
    onreload?: () => Promise<boolean>;
  }
  let { open, abstimmung = null, onsaved, onclose, ondelete, onreload }: Props = $props();

  interface Zeile {
    key: number;
    id?: number;
    text: string;
  }

  let titel = $state('');
  let beschreibung = $state('');
  /** „Beliebig viele“ as an empty value. */
  let maxAuswahl = $state('');
  let vielleichtErlaubt = $state(false);
  let sichtbarkeit = $state<AbstimmungSichtbarkeit>('offen');
  let zeilen = $state<Zeile[]>([]);
  let datum = $state('');
  let uhrzeit = $state('');
  /** Rows were added or removed outside the text fields. */
  let geaendert = $state(false);
  let nextKey = 0;
  const dialog = createDialogForm();
  const errors = $derived(dialog.state.fields);

  function zeile(text = '', id?: number): Zeile {
    return { key: nextKey++, id, text };
  }

  /** Puts the values of `abstimmung` (or an empty form) into the fields. */
  function fill(): void {
    titel = abstimmung?.titel ?? '';
    beschreibung = abstimmung?.beschreibung ?? '';
    maxAuswahl = abstimmung?.maxAuswahl ? String(abstimmung.maxAuswahl) : '';
    vielleichtErlaubt = abstimmung?.vielleichtErlaubt ?? false;
    sichtbarkeit = abstimmung?.sichtbarkeit ?? 'offen';
    zeilen = abstimmung
      ? abstimmung.optionen.map((option) => zeile(option.text, option.id))
      : [zeile(), zeile()];
    datum = '';
    uhrzeit = '';
    geaendert = false;
    dialog.reset();
  }

  // Fills the form whenever the dialog opens, before `EditDialog` puts back the input of an
  // expired login, so that input wins
  let warOffen = false;
  $effect.pre(() => {
    if (open && !warOffen) fill();
    warOffen = open;
  });

  /**
   * The rows as they were, before their texts are filled in again after a new login: which
   * option each row keeps (0 for a new one), so a text never lands on another option's votes.
   */
  const optionenStruktur: RescueField = {
    key: 'Optionen#custom',
    structure: true,
    get: () => JSON.stringify(zeilen.map((z) => z.id ?? 0)),
    describe: (value) => `${value.split(',').length} Optionen`,
    set(value) {
      let ids: unknown;
      try {
        ids = JSON.parse(value);
      } catch {
        return false;
      }
      const bekannt = new Map((abstimmung?.optionen ?? []).map((o) => [o.id, o.text]));
      if (
        !Array.isArray(ids) ||
        ids.length > MAX_ABSTIMMUNG_OPTIONEN ||
        !ids.every((id) => id === 0 || bekannt.has(id))
      )
        return false;
      zeilen = ids.map((id: number) => zeile(bekannt.get(id) ?? '', id || undefined));
      geaendert = true;
      return true;
    },
  };

  /** After a conflict: the current version replaces the input, so it is not saved over. */
  async function reload(): Promise<boolean> {
    if (!onreload || !(await onreload())) return false;
    await tick();
    fill();
    return true;
  }

  const voll = $derived(zeilen.length >= MAX_ABSTIMMUNG_OPTIONEN);

  const STUFEN: AbstimmungSichtbarkeit[] = ['offen', 'anonym', 'geheim'];
  /** Who answered relied on the setting: the answers never become more visible. */
  const beantwortet = $derived((abstimmung?.anzahlAntworten ?? 0) > 0);
  const bisherigeStufe = $derived(STUFEN.indexOf(abstimmung?.sichtbarkeit ?? 'offen'));
  /** Most „Ja“ of one person; a lower limit would break their answer. */
  const meisteJa = $derived(
    Math.max(0, ...(abstimmung?.antworten ?? []).map((antwort) => antwort.gewaehlt.length))
  );
  /** „Vielleicht“ stays on while someone answered with it. */
  const mitVielleicht = $derived((abstimmung?.optionen ?? []).some((o) => o.vielleicht > 0));
  /** The limits offered: up to one less than the options, and the current one. */
  const grenzen = $derived.by(() => {
    const optionen = zeilen.filter((z) => z.text.trim()).length;
    const hoechste = Math.max(2, optionen - 1, Number(maxAuswahl) || 0);
    return Array.from({ length: hoechste }, (_, index) => index + 1).filter(
      (grenze) => grenze >= meisteJa || String(grenze) === maxAuswahl
    );
  });

  async function focusRow(key: number): Promise<void> {
    await tick();
    document.getElementById(`abstimmung-option-${key}`)?.focus();
  }

  function addZeile(): void {
    if (voll) return;
    const neu = zeile();
    zeilen.push(neu);
    geaendert = true;
    void focusRow(neu.key);
  }

  function addTermin(): void {
    const text = terminText(datum, uhrzeit);
    if (!text) {
      dialog.invalid({ termin: 'Bitte wähle ein Datum.' });
      return;
    }
    dialog.clearField('termin');
    if (
      zeilen.some((z) => z.text.trim().toLocaleLowerCase('de') === text.toLocaleLowerCase('de'))
    ) {
      dialog.invalid({ termin: `„${text}“ steht schon in der Liste.` });
      return;
    }
    // A blank row is filled instead of leaving it empty above the date
    const leer = zeilen.find((z) => !z.text.trim() && !z.id);
    if (leer) leer.text = text;
    else if (!voll) zeilen.push(zeile(text));
    else return;
    geaendert = true;
    uhrzeit = '';
  }

  function removeZeile(index: number): void {
    zeilen.splice(index, 1);
    geaendert = true;
    // The focus stays in the list instead of falling back to the page
    const next = zeilen[index] ?? zeilen[index - 1];
    if (next) void focusRow(next.key);
    else document.getElementById('abstimmung-option-neu')?.focus();
  }

  /** Options whose votes would be lost; asked for in the delete question of the save. */
  const entfernteMitStimmen = $derived(
    abstimmung
      ? abstimmung.optionen.filter(
          // An emptied row is left out on saving, so its votes go too
          (option) =>
            option.stimmen + option.vielleicht > 0 &&
            !zeilen.some((z) => z.id === option.id && z.text.trim())
        )
      : []
  );
  /** Options with votes whose text changed; the votes then count for the new text. */
  const geaenderteMitStimmen = $derived(
    abstimmung
      ? abstimmung.optionen.filter(
          (option) =>
            zeilen.some(
              (z) => z.id === option.id && z.text.trim() && z.text.trim() !== option.text
            ) && option.stimmen + option.vielleicht > 0
        )
      : []
  );

  async function remove(): Promise<void> {
    if (!ondelete) return;
    await dialog.run(
      ondelete,
      'Die Abstimmung wurde nicht gelöscht. Lade die Seite neu und versuche es noch einmal.'
    );
  }

  async function save(): Promise<void> {
    const local: Record<string, string> = {};
    if (!titel.trim()) local.titel = 'Bitte schreib die Frage hin.';
    if (zeilen.filter((z) => z.text.trim()).length < 2)
      local.optionen = 'Bitte trag mindestens zwei Optionen ein.';
    if (dialog.invalid(local)) {
      await tick();
      document.getElementById(local.titel ? 'abstimmung-titel' : 'abstimmung-option-neu')?.focus();
      return;
    }
    const body = {
      titel,
      beschreibung,
      maxAuswahl: maxAuswahl ? Number(maxAuswahl) : null,
      vielleichtErlaubt,
      sichtbarkeit,
      optionen: zeilen.map((z) => (z.id ? { id: z.id, text: z.text } : { text: z.text })),
      // The votes the warning above was about; more cast meanwhile stop the save
      bekannteStimmen: Object.fromEntries(
        (abstimmung?.optionen ?? []).map((option) => [
          option.id,
          option.stimmen + option.vielleicht,
        ])
      ),
    };
    const current = abstimmung;
    await dialog.run(
      async () => {
        if (current) {
          await sendApi('PATCH', `/intern/pflege/abstimmungen/${current.id}`, {
            ...body,
            etag: current.etag,
          });
          onsaved(current.id, 'Abstimmung gespeichert.');
        } else {
          const { id } = await sendApi<{ id: number }>('POST', '/intern/pflege/abstimmungen', body);
          onsaved(id, 'Abstimmung angelegt.');
        }
      },
      current
        ? 'Die Abstimmung wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.'
        : 'Die Abstimmung wurde nicht angelegt. Deine Eingaben sind noch da. Tippe noch einmal auf „Abstimmung anlegen“.'
    );
  }
</script>

<EditDialog
  {open}
  title={abstimmung ? 'Abstimmung bearbeiten' : 'Neue Abstimmung'}
  submitLabel={abstimmung ? 'Speichern' : 'Abstimmung anlegen'}
  busyLabel={abstimmung ? 'Wird gespeichert …' : 'Wird angelegt …'}
  busy={dialog.state.busy}
  error={dialog.state.error}
  dirty={geaendert}
  rescueKey={`abstimmung:${abstimmung?.id ?? 'neu'}`}
  rescueVersion={abstimmung?.etag}
  rescueFields={[optionenStruktur]}
  onreload={dialog.state.conflict && onreload ? reload : undefined}
  onsubmit={() => void save()}
  {onclose}
  ondelete={abstimmung && ondelete ? remove : undefined}
  deleteTitle={`„${abstimmung?.titel ?? ''}“ löschen?`}
  deleteQuestion="Die Abstimmung mit allen Antworten löschen? Das lässt sich nicht rückgängig machen."
>
  <fieldset disabled={dialog.state.busy} class="min-w-0 space-y-5">
    <legend class="sr-only">Abstimmung</legend>
    <FormField id="abstimmung-titel" label="Frage" error={errors.titel}>
      {#snippet children(attrs)}
        <input
          {...attrs}
          class="form-input"
          maxlength="200"
          placeholder="z. B. Wann machen wir die Weihnachtsfeier?"
          bind:value={titel}
          oninput={() => dialog.clearField('titel')}
        />
      {/snippet}
    </FormField>
    <FormField
      id="abstimmung-beschreibung"
      label="Beschreibung"
      optional
      error={errors.beschreibung}
    >
      {#snippet children(attrs)}
        <textarea
          {...attrs}
          class="form-input"
          rows="3"
          maxlength="2000"
          placeholder="z. B. Ort, Dauer oder bis wann ihr abstimmen sollt"
          bind:value={beschreibung}></textarea>
      {/snippet}
    </FormField>

    <fieldset class="min-w-0">
      <legend class="font-semibold text-brand-900">Optionen</legend>
      {#if errors.optionen}
        <p class="mt-1 text-sm text-danger" role="alert">{errors.optionen}</p>
      {/if}
      <ol class="mt-2 space-y-2">
        {#each zeilen as z, index (z.key)}
          <li class="flex items-center gap-1">
            <label class="sr-only" for="abstimmung-option-{z.key}">Option {index + 1}</label>
            <input
              id="abstimmung-option-{z.key}"
              class="form-input min-w-0 flex-1"
              maxlength="200"
              placeholder={index === 0 ? 'z. B. Sa, 12.12., 18:00 Uhr' : 'z. B. Pizza'}
              bind:value={z.text}
              oninput={() => dialog.clearField('optionen')}
            />
            <button
              type="button"
              class="inline-flex size-11 shrink-0 items-center justify-center rounded text-danger"
              aria-label="Option {index + 1} entfernen{z.text.trim() ? `: ${z.text.trim()}` : ''}"
              onclick={() => removeZeile(index)}>✕</button
            >
          </li>
        {/each}
      </ol>
      <ActionButton
        id="abstimmung-option-neu"
        variant="secondary"
        class="mt-3"
        disabled={voll}
        onclick={addZeile}>Option hinzufügen</ActionButton
      >

      <div class="mt-4 border-t border-neutral-200 pt-4">
        <p id="abstimmung-termin-titel" class="font-semibold text-brand-900">Termin hinzufügen</p>
        <div class="mt-2 flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-sm">
            <span>Datum</span>
            <input
              type="date"
              class="form-input"
              bind:value={datum}
              aria-invalid={errors.termin ? 'true' : undefined}
              aria-describedby={errors.termin ? 'abstimmung-termin-fehler' : undefined}
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span>Uhrzeit <span class="text-neutral-700">(optional)</span></span>
            <input type="time" class="form-input" bind:value={uhrzeit} />
          </label>
          <ActionButton variant="secondary" disabled={voll} onclick={addTermin}
            >Termin hinzufügen</ActionButton
          >
        </div>
        {#if errors.termin}
          <p id="abstimmung-termin-fehler" class="mt-1 text-sm text-danger" role="alert">
            {errors.termin}
          </p>
        {/if}
      </div>
      {#if entfernteMitStimmen.length > 0}
        <p class="mt-4 border-l-4 border-l-warning py-1 pl-3 text-sm text-neutral-800">
          Beim Speichern gehen die Stimmen für {entfernteMitStimmen
            .map((option) => `„${option.text}“`)
            .join(', ')} verloren.
        </p>
      {/if}
      {#if geaenderteMitStimmen.length > 0}
        <p class="mt-4 border-l-4 border-l-warning py-1 pl-3 text-sm text-neutral-800">
          Die Stimmen für {geaenderteMitStimmen.map((option) => `„${option.text}“`).join(', ')}
          zählen danach für den neuen Text. Für einen anderen Termin leg besser eine neue Option an.
        </p>
      {/if}
    </fieldset>

    <FormField
      id="abstimmung-max"
      label={vielleichtErlaubt
        ? 'Wie viele Optionen darf man mit „Ja“ wählen?'
        : 'Wie viele Optionen darf man wählen?'}
      error={errors.maxAuswahl}
    >
      {#snippet children(attrs)}
        <select
          {...attrs}
          class="form-input"
          bind:value={maxAuswahl}
          onchange={() => {
            geaendert = true;
            dialog.clearField('maxAuswahl');
          }}
        >
          <option value="">Beliebig viele</option>
          {#each grenzen as grenze (grenze)}
            <option value={String(grenze)}
              >{grenze === 1 ? 'Nur eine' : `Höchstens ${grenze}`}</option
            >
          {/each}
        </select>
      {/snippet}
    </FormField>

    <div>
      <label class="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          bind:checked={vielleichtErlaubt}
          disabled={mitVielleicht && vielleichtErlaubt}
          onchange={() => {
            geaendert = true;
            dialog.clearField('vielleichtErlaubt');
          }}
        />
        <span>„Vielleicht“ als Antwort erlauben</span>
      </label>
      {#if mitVielleicht && vielleichtErlaubt}
        <p class="text-sm text-neutral-700">Es haben schon Leute mit „Vielleicht“ geantwortet.</p>
      {/if}
      {#if errors.vielleichtErlaubt}
        <p class="text-sm text-danger" role="alert">{errors.vielleichtErlaubt}</p>
      {/if}
    </div>

    <fieldset class="min-w-0">
      <legend class="font-semibold text-brand-900">Wer sieht die Antworten?</legend>
      <div class="mt-1">
        {#each STUFEN as stufe, index (stufe)}
          <label class="flex min-h-11 items-center gap-3 py-1">
            <input
              type="radio"
              name="abstimmung-sichtbarkeit"
              value={stufe}
              bind:group={sichtbarkeit}
              disabled={beantwortet && index < bisherigeStufe}
              onchange={() => {
                geaendert = true;
                dialog.clearField('sichtbarkeit');
              }}
            />
            <span>{SICHTBARKEIT_LABELS[stufe]}</span>
          </label>
        {/each}
      </div>
      {#if beantwortet && bisherigeStufe > 0}
        <p class="text-sm text-neutral-700">
          Es haben schon Leute abgestimmt. Ihre Antworten können nicht mehr für mehr Leute sichtbar
          werden.
        </p>
      {/if}
      {#if errors.sichtbarkeit}
        <p class="text-sm text-danger" role="alert">{errors.sichtbarkeit}</p>
      {/if}
    </fieldset>
  </fieldset>
</EditDialog>
