<script lang="ts">
  import { freigabeErwaehnte, freigabeMeldung } from '../../lib/protokollFreigabe';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ActionSheet from '../ui/ActionSheet.svelte';
  import Schalter from '../ui/Schalter.svelte';
  import ProtokollFreigabeDialog from './ProtokollFreigabeDialog.svelte';
  import ProtokollKorrektur from './ProtokollKorrektur.svelte';
  import ProtokollVersand from './ProtokollVersand.svelte';
  import { ApiError, errorMessage, fetchFile, saveFile, sendApi } from '../../lib/api';
  import { HELP_CONTACTS } from '../../lib/helpContacts';
  import { aufgabenAnzahl, formatDateTime, freigabeAufgaben } from '../../lib/protokollEditor';
  import type { ProtokollEditorDetail, ProtokollFreigabeResponse } from '../../lib/types';

  /**
   * The actions of minutes in the editor (#277, step 2): who gave them to the review, the note
   * when they came back, and the buttons in rows of two. The next step of the workflow is the
   * one wide, filled button (give to the review, approve, mail); views, the check for
   * corrections and rarely used steps (versions, approving without a review) follow, and
   * „Mitlesen“ is a switch below. Every leader may do these steps.
   */
  interface Props {
    detail: ProtokollEditorDetail;
    login: string;
    /** This tab writes; the check for corrections waits until the writing is finished. */
    writing?: boolean;
    /** Follow the writer while reading. */
    follow?: boolean;
    /** The draft can be finished here: nobody else writes. */
    canFinish?: boolean;
    /** Gives the draft to the review or approves it without one (dialogs of the editor). */
    onfinish: (action: 'review' | 'approve') => void;
    onpraesentation: () => void;
    onleseansicht: () => void;
    onversionen: () => void;
    /** Reloads the minutes after a step. */
    onchanged: () => Promise<unknown>;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
  }
  let {
    detail,
    login,
    writing = false,
    follow = $bindable(true),
    canFinish = false,
    onfinish,
    onpraesentation,
    onleseansicht,
    onversionen,
    onchanged,
    notify,
  }: Props = $props();

  let busy = $state(false);
  let approving = $state(false);
  let approveError = $state<string | null>(null);
  let rejecting = $state<{ note: string } | null>(null);
  let rejectError = $state<string | null>(null);
  let rejectFieldError = $state<string | null>(null);
  let mehrOpen = $state(false);

  const korrigierbar = $derived(detail.status === 'entwurf' || detail.status === 'review');
  const ohnePruefung = $derived(detail.status === 'entwurf' && canFinish);
  const own = $derived(login !== '' && detail.createdBy.toLowerCase() === login.toLowerCase());
  const draftPdf = $derived(detail.status === 'entwurf' || detail.status === 'review');

  /** Who gave the minutes to the review, approved and sent them, one line each. */
  const lines = $derived.by(() => {
    const result: string[] = [];
    if (detail.submittedBy && detail.status !== 'entwurf') {
      result.push(
        `Zur Prüfung gegeben von ${detail.submittedBy} am ${formatDateTime(detail.submittedAt)}`
      );
    }
    if (detail.approvedBy) {
      result.push(`Freigegeben von ${detail.approvedBy} am ${formatDateTime(detail.approvedAt)}`);
    }
    if (detail.versand?.state === 'sent') {
      result.push(
        `An ${detail.versand.recipients} Personen verschickt am ${formatDateTime(detail.versand.at)}`
      );
    }
    return result;
  });

  function url(suffix = ''): string {
    return `/intern/pflege/protokoll-editor/${detail.id}${suffix}`;
  }

  async function downloadPdf(): Promise<void> {
    busy = true;
    try {
      const { blob, fileName } = await fetchFile(`/intern/protokoll-editor/${detail.id}/pdf`);
      saveFile(blob, fileName ?? `${detail.date} ${detail.title}.pdf`);
    } catch (error: unknown) {
      notify(
        errorMessage(
          error,
          'Das PDF konnte nicht erstellt werden. Prüfe deine Internetverbindung und tippe noch einmal auf „PDF herunterladen“.'
        ),
        'error'
      );
    } finally {
      busy = false;
    }
  }

  async function approve(ownConfirmed: boolean): Promise<void> {
    busy = true;
    approveError = null;
    try {
      const result = await sendApi<ProtokollFreigabeResponse>('POST', url('/review'), {
        action: 'approve',
        etag: detail.etag,
        ownConfirmed,
      });
      approving = false;
      notify(freigabeMeldung(result, detail.title));
      await onchanged();
    } catch (error: unknown) {
      approveError = errorMessage(
        error,
        'Das Protokoll wurde nicht freigegeben. Tippe noch einmal auf „Freigeben“.'
      );
      if (error instanceof ApiError && error.status === 409) await onchanged();
    } finally {
      busy = false;
    }
  }

  async function reject(): Promise<void> {
    if (!rejecting) return;
    busy = true;
    rejectError = null;
    rejectFieldError = null;
    try {
      const result = await sendApi<{ mailSent: boolean }>('POST', url('/review'), {
        action: 'reject',
        etag: detail.etag,
        note: rejecting.note,
      });
      rejecting = null;
      notify(
        result.mailSent
          ? `Zurückgegeben. ${detail.createdBy} bekommt den Hinweis per Mail.`
          : 'Zurückgegeben. Die Mail mit dem Hinweis ging nicht raus.',
        result.mailSent ? 'success' : 'warning'
      );
      await onchanged();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields?.note) rejectFieldError = error.fields.note;
      else
        rejectError = errorMessage(
          error,
          'Das Protokoll wurde nicht zurückgegeben. Dein Hinweis ist noch da. Tippe noch einmal auf „Zurückgeben“.'
        );
    } finally {
      busy = false;
    }
  }

  /** Closes „Mehr“ first, so its dialog does not stay under the next one. */
  async function ausMehr(action: () => void): Promise<void> {
    mehrOpen = false;
    await tick();
    action();
  }
</script>

<section class="space-y-3 border-b border-neutral-200 pb-4" aria-label="Aktionen zum Protokoll">
  {#if lines.length > 0}
    <p class="text-sm text-neutral-700">
      {#each lines as line, index (line)}
        {#if index > 0}<br />{/if}{line}
      {/each}
    </p>
  {/if}

  {#if detail.aufgabenAngelegt > 0}
    <p class="text-sm text-neutral-700">
      Aus diesem Protokoll {detail.aufgabenAngelegt === 1 ? 'stammt' : 'stammen'}
      {aufgabenAnzahl(detail.aufgabenAngelegt)} im Modul Aufgaben.
      <a href="/leitendenbereich/aufgaben" class="text-link underline">Zu den Aufgaben</a>
    </p>
  {/if}

  {#if detail.status === 'entwurf' && detail.reviewNote}
    <div class="border-l-2 border-warning py-1 pl-4 text-sm">
      <p class="font-semibold text-warning">Zurückgegeben mit dem Hinweis:</p>
      <p class="whitespace-pre-line text-neutral-800">{detail.reviewNote}</p>
    </div>
  {/if}

  {#if detail.versand?.state === 'attempted'}
    <p class="border-l-2 border-danger py-1 pl-4 text-sm text-danger">
      Der Versand wurde gestartet, aber nicht bestätigt. Bitte im Postfach des Absenders unter
      „Gesendete Elemente“ nachsehen, bevor du erneut sendest.
    </p>
  {/if}
  {#if detail.status === 'freigegeben' && !detail.sendingConfigured}
    <p class="text-sm text-neutral-700">
      Verschicken ist hier noch nicht eingerichtet. Schreib an {HELP_CONTACTS.technik}.
    </p>
  {/if}

  <div class="grid max-w-xl grid-cols-2 gap-2">
    {#if detail.status === 'entwurf'}
      {#if canFinish}
        <ActionButton class="col-span-2" onclick={() => onfinish('review')}>
          Zur Prüfung geben
        </ActionButton>
      {/if}
    {:else if detail.status === 'review'}
      <ActionButton
        variant="primary"
        class="w-full"
        disabled={busy}
        onclick={() => {
          approving = true;
          approveError = null;
        }}
      >
        Freigeben
      </ActionButton>
      <ActionButton
        class="w-full"
        disabled={busy}
        onclick={() => {
          rejecting = { note: '' };
          rejectError = null;
          rejectFieldError = null;
        }}
      >
        Zurückgeben
      </ActionButton>
    {:else if detail.sendingConfigured}
      <ProtokollVersand class="col-span-2" {detail} {onchanged} {notify} />
    {/if}
    <ActionButton class="w-full" disabled={busy} onclick={downloadPdf}>
      {draftPdf ? 'PDF-Vorschau' : 'PDF herunterladen'}
    </ActionButton>
    <ActionButton class="w-full" onclick={onpraesentation}>Präsentation</ActionButton>
  </div>

  {#snippet mehr()}
    <!-- „Mehr“ only when it holds more than the versions -->
    {#if ohnePruefung}
      <ActionButton class="w-full" aria-haspopup="dialog" onclick={() => (mehrOpen = true)}>
        <span aria-hidden="true">⋯</span> Mehr
      </ActionButton>
    {:else}
      <ActionButton class="w-full" onclick={onversionen}>Versionen</ActionButton>
    {/if}
  {/snippet}
  {#if korrigierbar}
    <!-- Hidden, not removed, while writing: the proposals stay for after the writing -->
    <div hidden={writing}>
      <ProtokollKorrektur {detail} {onchanged} nebenan={mehr} />
    </div>
  {/if}
  {#if !korrigierbar || writing}
    <div class="grid max-w-xl grid-cols-2 gap-2">
      {#if writing}
        <ActionButton class="w-full" onclick={onleseansicht}>Leseansicht</ActionButton>
      {:else if detail.ablage?.webUrl}
        <a
          class="btn-secondary w-full"
          href={detail.ablage.webUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Im Ordner öffnen<span class="sr-only"> (Protokoll-Ordner, neues Fenster)</span>
        </a>
      {/if}
      {@render mehr()}
    </div>
  {/if}

  {#if !writing}
    <Schalter label="Mitlesen" bind:checked={follow} />
  {/if}
</section>

<ActionSheet open={mehrOpen} title="Weitere Aktionen" onclose={() => (mehrOpen = false)}>
  <div class="grid gap-3">
    <ActionButton onclick={() => void ausMehr(onversionen)}>Versionen</ActionButton>
    <ActionButton onclick={() => void ausMehr(() => onfinish('approve'))}>
      Ohne Prüfung freigeben
    </ActionButton>
  </div>
</ActionSheet>

<ProtokollFreigabeDialog
  open={approving}
  title={detail.title}
  {own}
  draft={false}
  version={detail.etag}
  consequence="Das Protokoll wird als PDF im Protokoll-Ordner abgelegt und lässt sich danach nicht mehr ändern."
  aufgaben={freigabeAufgaben(detail.inhalt)}
  erwaehnte={freigabeErwaehnte(detail.inhalt, login)}
  {busy}
  error={approveError}
  onclose={() => {
    if (!busy) approving = false;
  }}
  onconfirm={(ownConfirmed) => void approve(ownConfirmed)}
/>

<EditDialog
  open={rejecting !== null}
  title="Protokoll zurückgeben"
  {busy}
  error={rejectError}
  submitLabel="Zurückgeben"
  busyLabel="Wird zurückgegeben …"
  onsubmit={reject}
  onclose={() => {
    if (!busy) rejecting = null;
  }}
>
  {#if rejecting}
    <FormField
      id="protokoll-review-note"
      label="Was fehlt noch?"
      hint={detail.createdBy ? `Geht per Mail an ${detail.createdBy}.` : undefined}
      error={rejectFieldError ?? undefined}
    >
      {#snippet children(attrs)}
        <textarea
          {...attrs}
          class="form-input"
          rows="4"
          maxlength="2000"
          required
          bind:value={rejecting!.note}></textarea>
      {/snippet}
    </FormField>
  {/if}
</EditDialog>
