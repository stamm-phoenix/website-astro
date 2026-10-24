<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import ProtokollEmpfaenger from '../protokolle/ProtokollEmpfaenger.svelte';
  import { sendApi } from '../../lib/api';
  import { fotoKind } from '../../lib/fotoPfade';
  import { fotoUpload, unnotifiedFotoNames } from '../../lib/fotoUpload.svelte';
  import type { ProtokollVersandAuswahl, ProtokollVersandPreview } from '../../lib/protokolleView';
  import {
    LIST_RELOADED,
    auswahlBody,
    auswahlCount,
    auswahlDirty,
    pendingProblem,
    personen,
    refreshAuswahl,
    startAuswahl,
    versandProblem,
  } from '../../lib/protokolleView';

  interface Props {
    /** Folder the files went to. */
    path: string;
  }
  let { path }: Props = $props();

  const LOAD_FAILED =
    'Die Leitenden konnten nicht aus CampFlow geladen werden, es wurde nichts verschickt. Prüfe deine Internetverbindung und versuche es noch einmal.';

  let auswahl = $state<ProtokollVersandAuswahl | null>(null);
  /** Files the open dialog is about, as they were when it opened. */
  let names = $state<string[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Why the list could not be loaded; the result of a sent note shows in the progress. */
  let message = $state<string | null>(null);

  const open = $derived(unnotifiedFotoNames());
  const count = $derived(auswahl ? auswahlCount(auswahl) : 0);
  const folderName = $derived(path.split('/').filter(Boolean).slice(-2).join(' / '));

  /** „3 neue Fotos“, „2 neue Fotos und 1 neues Video“, like the subject of the mail. */
  function anzahl(files: string[]): string {
    const videos = files.filter((name) => fotoKind(name) === 'video').length;
    const photos = files.length - videos;
    return [
      photos ? (photos === 1 ? '1 neues Foto' : `${photos} neue Fotos`) : '',
      videos ? (videos === 1 ? '1 neues Video' : `${videos} neue Videos`) : '',
    ]
      .filter(Boolean)
      .join(' und ');
  }

  async function preview(): Promise<ProtokollVersandPreview> {
    return sendApi<ProtokollVersandPreview>('POST', '/intern/fotos/benachrichtigung', {
      action: 'preview',
    });
  }

  async function start(): Promise<void> {
    loading = true;
    message = null;
    try {
      auswahl = startAuswahl(await preview(), false);
      names = open;
      error = null;
    } catch (failure: unknown) {
      message = versandProblem(failure, LOAD_FAILED);
    } finally {
      loading = false;
    }
  }

  async function send(): Promise<void> {
    if (!auswahl) return;
    error = pendingProblem(auswahl);
    if (error) return;
    busy = true;
    try {
      const result = await sendApi<{ recipients: number }>(
        'POST',
        '/intern/fotos/benachrichtigung',
        { action: 'send', pfad: path, dateien: names, ...auswahlBody(auswahl) }
      );
      fotoUpload.notified = {
        recipients: result.recipients,
        names: [...(fotoUpload.notified?.names ?? []), ...names],
      };
      auswahl = null;
    } catch (failure: unknown) {
      error = versandProblem(
        failure,
        'Es ist unklar, ob die Benachrichtigung verschickt wurde. Frag kurz in der Leitendenrunde nach, bevor du sie noch einmal schickst.'
      );
      // A changed list in CampFlow is taken over, so the selection can be checked and sent
      const reloaded = await preview().catch(() => null);
      if (auswahl && reloaded) {
        const refreshed = refreshAuswahl(auswahl, reloaded);
        auswahl = refreshed.auswahl;
        if (refreshed.changed) error = `${error} ${LIST_RELOADED}`;
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if open.length > 0}
  <ActionButton disabled={loading} aria-busy={loading} onclick={() => void start()}>
    {loading ? 'Leitende werden geladen …' : 'Leitende benachrichtigen'}
  </ActionButton>
{/if}

<StatusNotice {message} kind="error" popup />

<EditDialog
  open={auswahl !== null}
  title="Leitende benachrichtigen?"
  {busy}
  {error}
  submitLabel={`An ${personen(count)} schicken`}
  busyLabel="Wird verschickt …"
  submitDisabled={!auswahl || count === 0}
  dirty={auswahlDirty(auswahl)}
  onsubmit={() => void send()}
  onclose={() => {
    if (!busy) auswahl = null;
  }}
>
  {#if auswahl}
    <p class="text-sm text-neutral-800">
      Alle mit Häkchen bekommen eine Mail: {anzahl(names)} in „{folderName}“, mit kleinen
      Vorschaubildern und Link zum Ordner.
    </p>
    <ProtokollEmpfaenger
      list={auswahl.list}
      bind:excluded={auswahl.excluded}
      bind:extra={auswahl.extra}
      bind:pending={auswahl.pending}
      disabled={busy}
      subject="die Mail"
      emptyText="In CampFlow wurden keine Leitenden mit E-Mail gefunden."
      fieldId="foto-benachrichtigung-extra"
    />
  {/if}
</EditDialog>
