<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import { errorMessage } from '../../lib/api';
  import { ApiError } from '../../lib/apiError';
  import { setzeStatus, type StatusStand } from '../../lib/postfachStore.svelte';
  import { mailZeitKurz, STATUS_LABEL } from '../../lib/postfachAnsicht';
  import type { PostfachStatus } from '../../../../api/lib/postfach-model';

  /**
   * Where the conversation stands, for everyone who sees the mailbox and in Outlook: new,
   * needs action (a flag) or done (a completed flag). Saves at once; a reply after „Erledigt“
   * makes it new again.
   */
  interface Props {
    postfach: string;
    konversation: string;
    status: PostfachStatus;
    erledigtAm: string | null;
    /** Received time of the newest message shown; a newer one is not closed unseen. */
    bis: string;
    /** A preview: shown, but not changed. */
    nurLesen: boolean;
    /** After a save, with the conversation it was for, what was saved and up to which message. */
    onaenderung: (konversation: string, stand: StatusStand, bis: string) => void;
    /** After a conflict: the page reloads what is current. */
    onkonflikt: (konversation: string) => void;
  }
  let {
    postfach,
    konversation,
    status,
    erledigtAm,
    bis,
    nurLesen,
    onaenderung,
    onkonflikt,
  }: Props = $props();

  const OPTIONEN = [
    { value: 'neu', label: STATUS_LABEL.neu, tone: 'neutral' },
    { value: 'handlungsbedarf', label: STATUS_LABEL.handlungsbedarf, tone: 'warning' },
    { value: 'erledigt', label: STATUS_LABEL.erledigt, tone: 'success' },
  ] as const;

  const ERFOLG: Record<PostfachStatus, string> = {
    neu: 'Wieder als neu markiert.',
    handlungsbedarf: 'Mit „Handlungsbedarf“ markiert.',
    erledigt: 'Als erledigt markiert.',
  };

  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let fehler = $state<string | null>(null);

  const hinweis = $derived(
    nurLesen
      ? 'In der Vorschau nur zum Ansehen.'
      : status === 'erledigt' && erledigtAm
        ? `Erledigt ${mailZeitKurz(erledigtAm)} · Wird sofort gespeichert.`
        : 'Wird sofort gespeichert.'
  );

  async function waehle(neu: PostfachStatus): Promise<void> {
    if (neu === status || busy || nurLesen) return;
    const fuer = konversation;
    busy = true;
    meldung = null;
    fehler = null;
    try {
      const gesehen = bis;
      const result = await setzeStatus(postfach, fuer, neu, status, gesehen);
      // Overtaken by a later change of this conversation: the page reads what applies now
      if (result.ueberholt) onkonflikt(fuer);
      else onaenderung(fuer, result, gesehen);
      if (fuer !== konversation) return;
      meldung = ERFOLG[neu];
    } catch (error: unknown) {
      // A conflict, or a change that failed half way: the page reads what applies now
      if (error instanceof ApiError && (error.status === 409 || error.status >= 500))
        onkonflikt(fuer);
      if (fuer !== konversation) return;
      fehler = errorMessage(
        error,
        'Der Stand konnte nicht gespeichert werden. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-2">
  <FilterTabs
    label="Stand"
    showLabel
    variant="segmented"
    options={OPTIONEN}
    value={status}
    disabled={busy || nurLesen}
    onselect={(value) => void waehle(value)}
  />
  <p class="text-sm text-neutral-700">{hinweis}</p>
  {#if meldung}<p role="status" class="text-sm text-success">{meldung}</p>{/if}
  {#if fehler}<p role="alert" class="text-sm text-danger"><MessageText text={fehler} /></p>{/if}
</div>
