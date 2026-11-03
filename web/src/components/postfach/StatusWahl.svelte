<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import { errorMessage } from '../../lib/api';
  import { ApiError } from '../../lib/apiError';
  import { setzeStatus } from '../../lib/postfachStore.svelte';
  import { mailZeitKurz, STATUS_LABEL } from '../../lib/postfachAnsicht';
  import {
    statusVon,
    type Erledigung,
    type PostfachStatus,
  } from '../../../../api/lib/postfach-model';

  /**
   * Where the conversation stands, for everyone who sees the mailbox: open, done or nothing to
   * do. Saves at once; a newer message after „Erledigt“ makes it open again.
   */
  interface Props {
    postfach: string;
    konversation: string;
    erledigung: Erledigung | null;
    wiederOffen: boolean;
    /** Received time of the newest message shown; a newer one keeps the conversation open. */
    bis: string;
    ich: string;
    /** After a save, with the conversation it was for and what applies now. */
    onaenderung: (konversation: string, erledigung: Erledigung | null) => void;
    /** After a conflict: the page reloads what is current. */
    onkonflikt: (konversation: string) => void;
  }
  let {
    postfach,
    konversation,
    erledigung,
    wiederOffen,
    bis,
    ich,
    onaenderung,
    onkonflikt,
  }: Props = $props();

  const OPTIONEN = [
    { value: 'offen', label: STATUS_LABEL.offen, tone: 'neutral' },
    { value: 'erledigt', label: STATUS_LABEL.erledigt, tone: 'success' },
    { value: 'kein_handlungsbedarf', label: STATUS_LABEL.kein_handlungsbedarf, tone: 'success' },
  ] as const;

  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let fehler = $state<string | null>(null);

  const status = $derived(statusVon({ erledigung }));
  const hinweis = $derived(
    erledigung
      ? `${STATUS_LABEL[erledigung.status]} von ${
          erledigung.login.toLowerCase() === ich.toLowerCase() ? 'dir' : erledigung.name
        }, ${mailZeitKurz(erledigung.am)} · Wird sofort gespeichert.`
      : 'Wird sofort gespeichert.'
  );

  async function waehle(neu: PostfachStatus): Promise<void> {
    if (neu === status || busy) return;
    const fuer = konversation;
    busy = true;
    meldung = null;
    fehler = null;
    try {
      const result = await setzeStatus(postfach, fuer, neu, status, bis);
      onaenderung(fuer, result);
      if (fuer !== konversation) return;
      meldung =
        neu === 'offen'
          ? 'Wieder als offen markiert.'
          : neu === 'erledigt'
            ? 'Als erledigt markiert.'
            : 'Als „Kein Handlungsbedarf“ markiert.';
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) onkonflikt(fuer);
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
    disabled={busy}
    onselect={(value) => void waehle(value)}
  />
  <p class="text-sm text-neutral-700">{hinweis}</p>
  {#if wiederOffen && !erledigung}
    <p class="text-sm font-semibold text-warning">
      Nach „Erledigt“ ist eine neue Nachricht gekommen.
    </p>
  {/if}
  {#if meldung}<p role="status" class="text-sm text-success">{meldung}</p>{/if}
  {#if fehler}<p role="alert" class="text-sm text-danger"><MessageText text={fehler} /></p>{/if}
</div>
