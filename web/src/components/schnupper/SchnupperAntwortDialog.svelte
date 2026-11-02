<script lang="ts">
  import { tick } from 'svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import GermanDateInput from '../ui/GermanDateInput.svelte';
  import { sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { SCHNUPPER_MAX_LENGTH, SCHNUPPER_STUFE_LABELS } from '../../lib/schnupper';
  import type { SchnupperAntwortErgebnis, StaffSchnupperAnfrage } from '../../lib/schnupper';

  interface Props {
    anfrage: StaffSchnupperAnfrage;
    /** `bestaetigen` sends a date, `absagen` a cancellation. */
    art: 'bestaetigen' | 'absagen';
    /** Loads the requests again and returns the current version of this one. */
    onreload: (id: number) => Promise<StaffSchnupperAnfrage | null>;
    ondone: (ergebnis: SchnupperAntwortErgebnis | null, message: string) => void | Promise<void>;
    onclose: () => void;
  }
  let { anfrage, art, onreload, ondone, onclose }: Props = $props();

  // The dialog is mounted anew for every request, so the start values are all it needs
  // svelte-ignore state_referenced_locally
  let current = $state(anfrage);
  // svelte-ignore state_referenced_locally
  let datum = $state(anfrage.termin?.datum ?? '');
  // svelte-ignore state_referenced_locally
  let zeit = $state(anfrage.termin?.zeit ?? '');
  // svelte-ignore state_referenced_locally
  let ort = $state(anfrage.termin?.ort ?? '');
  let antwort = $state('');
  const dialog = createDialogForm();
  let reloading = $state(false);
  const busy = $derived(dialog.state.busy || reloading);
  const fields = $derived(dialog.state.fields);
  const bestaetigen = $derived(art === 'bestaetigen');

  const wer = $derived(
    `${current.kindVorname ? `${current.kindVorname}, ` : ''}${current.alter} Jahre, ${SCHNUPPER_STUFE_LABELS[current.stufe]}`
  );
  const titel = $derived(
    bestaetigen
      ? current.termin
        ? `Neuen Termin schicken: ${wer}`
        : `Termin bestätigen: ${wer}`
      : `Absagen: ${wer}`
  );
  const submitLabel = $derived(
    bestaetigen ? (current.termin ? 'Neuen Termin schicken' : 'Termin bestätigen') : 'Absagen'
  );

  async function save(): Promise<void> {
    if (busy) return;
    const own: Record<string, string> = {};
    if (bestaetigen && !datum) own.datum = 'Bitte ein Datum angeben.';
    if (bestaetigen && !zeit) own.zeit = 'Bitte eine Uhrzeit angeben.';
    if (dialog.invalid(own)) {
      await tick();
      document.getElementById(own.datum ? 'schnupper-datum' : 'schnupper-zeit')?.focus();
      return;
    }
    const body = bestaetigen
      ? { datum, zeit, ort, antwort, etag: current.etag }
      : { antwort, etag: current.etag };
    await dialog.run(
      async () => {
        const ergebnis = await sendApi<SchnupperAntwortErgebnis>(
          'POST',
          `/intern/pflege/schnupperanfragen/${current.id}/${art}`,
          body
        );
        const getan = bestaetigen ? 'Termin bestätigt.' : 'Abgesagt.';
        await ondone(
          ergebnis,
          ergebnis.mailSent
            ? `${getan} ${current.name} hat eine E-Mail bekommen.`
            : `${getan} Die E-Mail an ${current.name} konnte nicht gesendet werden. Schreib bitte selbst an ${current.email}.`
        );
      },
      bestaetigen
        ? 'Der Termin wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Termin bestätigen“.'
        : 'Die Absage wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Absagen“.'
    );
  }

  /** After a conflict: shows the current state of the request, the input stays. */
  async function reloadCurrent(): Promise<boolean> {
    reloading = true;
    let fresh: StaffSchnupperAnfrage | null;
    try {
      fresh = await onreload(current.id);
    } finally {
      reloading = false;
    }
    if (!fresh) {
      await ondone(null, 'Die Anfrage wurde inzwischen gelöscht.');
      return false;
    }
    current = fresh;
    dialog.reset();
    return true;
  }
</script>

<EditDialog
  open
  title={titel}
  rescueKey={`schnupper-${art}:${current.id}`}
  rescueVersion={current.etag}
  {busy}
  error={dialog.state.error}
  {submitLabel}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  {onclose}
>
  <fieldset disabled={busy} class="min-w-0 space-y-4">
    {#if bestaetigen}
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField id="schnupper-datum" label="Datum" error={fields.datum}>
          {#snippet children(attrs)}
            <GermanDateInput
              {...attrs}
              value={datum}
              required
              onchange={(value) => (datum = value)}
            />
          {/snippet}
        </FormField>
        <FormField id="schnupper-zeit" label="Uhrzeit" error={fields.zeit}>
          {#snippet children(attrs)}
            <input {...attrs} type="time" class="form-input" required bind:value={zeit} />
          {/snippet}
        </FormField>
      </div>
      <FormField id="schnupper-ort" label="Treffpunkt" optional error={fields.ort}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            type="text"
            class="form-input"
            maxlength={SCHNUPPER_MAX_LENGTH.ort}
            placeholder="z. B. Pfarrheim, Eingang Gruppenraum"
            bind:value={ort}
          />
        {/snippet}
      </FormField>
    {/if}
    <FormField
      id="schnupper-antwort"
      label={`Nachricht an ${current.name}`}
      optional
      error={fields.antwort}
    >
      {#snippet children(attrs)}
        <textarea
          {...attrs}
          class="form-input"
          rows="4"
          maxlength={SCHNUPPER_MAX_LENGTH.antwort}
          placeholder={bestaetigen
            ? 'z. B. Bitte feste Schuhe anziehen, wir sind draußen.'
            : 'z. B. Die Gruppe ist gerade voll. Melde dich gern im Frühjahr wieder.'}
          bind:value={antwort}></textarea>
      {/snippet}
    </FormField>
  </fieldset>
</EditDialog>
