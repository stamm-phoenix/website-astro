<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import Aktionsraster from '../ui/Aktionsraster.svelte';
  import MehrAktionen, { type MehrAktion } from '../ui/MehrAktionen.svelte';
  import type { StaffProtokoll } from '../../../../api/lib/protokolle-model';

  /**
   * The buttons of one Word minutes card in rows of two, like the editor's block: the next step
   * of the workflow is the one filled button on top (give to the review, approve, mail), then
   * the views of the file; rarely used steps (copy link, reopen, approve without a review,
   * delete) are behind „⋯ Mehr“.
   */
  interface Props {
    protokoll: StaffProtokoll;
    /** An action of this card is running. */
    busy: boolean;
    /** Mailing is set up and may be offered. */
    sendingConfigured: boolean;
    previewOpen: boolean;
    /** The card's status is done (sent or archived). */
    done: boolean;
    mayDelete: boolean;
    onreview: () => void;
    onapprove: () => void;
    onreject: () => void;
    onsend: () => void;
    onreopen: () => void;
    oncopylink: () => void;
    onpdf: () => void;
    onpreview: () => void;
    ondelete: () => void;
  }
  let {
    protokoll,
    busy,
    sendingConfigured,
    previewOpen,
    done,
    mayDelete,
    onreview,
    onapprove,
    onreject,
    onsend,
    onreopen,
    oncopylink,
    onpdf,
    onpreview,
    ondelete,
  }: Props = $props();

  const isDocx = $derived(protokoll.fileName.toLowerCase().endsWith('.docx'));
  const isTxt = $derived(protokoll.fileName.toLowerCase().endsWith('.txt'));

  const mehr = $derived<MehrAktion[]>([
    ...(protokoll.webUrl ? [{ label: 'Link kopieren', onclick: oncopylink }] : []),
    ...(protokoll.status === 'Freigegeben' && !protokoll.delivery
      ? [{ label: 'Wieder bearbeiten', onclick: onreopen, disabled: busy }]
      : []),
    ...(protokoll.status === 'Entwurf'
      ? [{ label: 'Ohne Prüfung freigeben', onclick: onapprove, disabled: busy }]
      : []),
    ...(mayDelete
      ? [{ label: 'Löschen', onclick: ondelete, disabled: busy, variant: 'danger' as const }]
      : []),
  ]);
</script>

<Aktionsraster>
  {#if protokoll.status === 'Entwurf'}
    <ActionButton
      variant="primary"
      class="col-span-2"
      disabled={busy}
      aria-busy={busy}
      onclick={onreview}
    >
      Zur Prüfung geben
    </ActionButton>
  {:else if protokoll.status === 'Review'}
    <ActionButton variant="primary" disabled={busy} onclick={onapprove}>Freigeben</ActionButton>
    <ActionButton disabled={busy} onclick={onreject}>Zurückgeben</ActionButton>
  {:else if protokoll.status === 'Freigegeben' && sendingConfigured && !protokoll.changedSinceApproval}
    <ActionButton
      variant={protokoll.delivery ? 'danger' : 'primary'}
      class="col-span-2"
      disabled={busy}
      aria-busy={busy}
      onclick={onsend}
    >
      {protokoll.delivery ? 'Erneut senden' : 'Protokoll verschicken'}
    </ActionButton>
  {/if}

  {#if protokoll.webUrl}
    <a class="btn-secondary" href={protokoll.webUrl} target="_blank" rel="noopener noreferrer">
      {isDocx ? `In Word ${done ? 'öffnen' : 'bearbeiten'}` : 'Datei öffnen'}<span class="sr-only">
        ({protokoll.title}, neues Fenster)
      </span>
    </a>
  {/if}
  <ActionButton disabled={busy} onclick={onpdf}>
    {isTxt ? 'TXT' : 'PDF'}<span class="sr-only"> von {protokoll.title} herunterladen</span>
  </ActionButton>
  <ActionButton
    aria-expanded={previewOpen}
    aria-controls="protokoll-preview-{protokoll.id}"
    onclick={onpreview}
  >
    {previewOpen ? 'Vorschau schließen' : 'Vorschau'}<span class="sr-only">
      ({protokoll.title})
    </span>
  </ActionButton>
  <MehrAktionen
    aktionen={mehr}
    title="Weitere Aktionen zu „{protokoll.title}“"
    bezug={protokoll.title}
  />
</Aktionsraster>
