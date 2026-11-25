<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { FAHRT_LABEL } from '../../lib/fahrtenPlan';
  import type { Fahrt, FahrtPlan } from '../../lib/fahrtenPlan';
  import { fahrtenMailBody, mailFahrer, namensListe } from '../../lib/fahrtenMail';
  import type { FahrtenMailErgebnis } from '../../../../api/lib/fahrten-mail-model';

  interface Props {
    /** CampFlow id of the Aktion. */
    eventId: string;
    plans: Record<Fahrt, FahrtPlan>;
    onresult: (result: { message: string; kind: 'success' | 'error' }) => void;
    /** Classes of the button that opens the dialog, e.g. its place in a grid. */
    class?: string;
  }

  let { eventId, plans, onresult, class: className = '' }: Props = $props();

  let open = $state(false);
  let nachricht = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** After a partly failed send, only these drivers get their mail again. */
  let nurAn = $state<string[] | null>(null);

  const fahrer = $derived(mailFahrer(plans));
  const empfaenger = $derived(
    fahrer.filter((f) => f.person.hatEmail && (nurAn === null || nurAn.includes(f.person.id)))
  );

  function fahrtenText(fahrten: Fahrt[]): string {
    return fahrten.length === 2 ? 'Hin- und Rückfahrt' : FAHRT_LABEL[fahrten[0]];
  }

  function show(): void {
    error = null;
    nurAn = null;
    open = true;
  }

  function close(): void {
    if (busy) return;
    open = false;
  }

  async function send(): Promise<void> {
    if (busy || empfaenger.length === 0) return;
    busy = true;
    error = null;
    const ids = new Set(empfaenger.map((f) => f.person.id));
    const body = fahrtenMailBody(plans, nachricht);
    body.fahrten.hin = body.fahrten.hin.filter((auto) => ids.has(auto.fahrer));
    body.fahrten.rueck = body.fahrten.rueck.filter((auto) => ids.has(auto.fahrer));
    try {
      const ergebnis = await sendApi<FahrtenMailErgebnis>(
        'POST',
        `/intern/aktionen/${encodeURIComponent(eventId)}/fahrten-mail`,
        body
      );
      if (ergebnis.fehlgeschlagen.length > 0) {
        nurAn = ergebnis.fehlgeschlagen.map((f) => f.id);
        error = `Die Mail an ${namensListe(ergebnis.fehlgeschlagen.map((f) => f.name))} ging nicht raus.${
          ergebnis.gesendet.length > 0
            ? ` Die anderen ${ergebnis.gesendet.length} haben sie bekommen.`
            : ''
        } Versuch es gleich noch einmal. Klappt es weiter nicht, schreib an admin@stamm-phoenix.de.`;
        return;
      }
      open = false;
      nachricht = '';
      const anzahl =
        ergebnis.gesendet.length <= 3
          ? namensListe(ergebnis.gesendet)
          : `${ergebnis.gesendet.length} Fahrende`;
      onresult({
        kind: 'success',
        message: ergebnis.vorschau
          ? `In der Vorschau geht keine Mail raus. Bekommen hätten sie: ${anzahl}.`
          : `Mail an ${anzahl} gesendet.`,
      });
    } catch (caught: unknown) {
      error = errorMessage(
        caught,
        'Die Mails konnten nicht gesendet werden. Es ist keine Mail rausgegangen. Versuch es gleich noch einmal.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<ActionButton class={className} onclick={show} disabled={fahrer.length === 0}>
  Fahrende per Mail informieren
</ActionButton>

<EditDialog
  {open}
  title="Fahrende per Mail informieren"
  {busy}
  {error}
  submitDisabled={empfaenger.length === 0}
  submitLabel={nurAn
    ? `Noch einmal an ${empfaenger.length} senden`
    : `Mail an ${empfaenger.length} senden`}
  busyLabel="Mails werden gesendet …"
  onsubmit={send}
  onclose={close}
>
  <div class="space-y-4">
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each fahrer as f (f.person.id)}
        <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
          <span>
            <span class="font-semibold text-brand-900">{f.person.name}</span>
            <span class="text-sm text-neutral-700">{fahrtenText(f.fahrten)}</span>
          </span>
          {#if !f.person.hatEmail}
            <StatusLabel label="Keine E-Mail in CampFlow" tone="warning" />
          {:else if nurAn && !nurAn.includes(f.person.id)}
            <StatusLabel label="Gesendet" tone="success" />
          {/if}
        </li>
      {/each}
    </ul>

    <FormField
      id="fahrten-mail-nachricht"
      label="Nachricht an alle Fahrenden"
      optional
      info="Jede Mail nennt die Mitfahrenden mit Telefonnummer für Hin- und Rückfahrt. Antworten gehen an dich."
    >
      {#snippet children(attrs)}
        <textarea
          {...attrs}
          class="form-input min-h-28"
          maxlength="1000"
          placeholder="z. B. Treffpunkt Samstag 9 Uhr am Pfarrheim"
          bind:value={nachricht}></textarea>
      {/snippet}
    </FormField>
  </div>
</EditDialog>
