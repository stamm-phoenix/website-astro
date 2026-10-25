<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import ProtokollEmpfaenger from '../protokolle/ProtokollEmpfaenger.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { PERSON_GRUPPE_LABELS } from '../../lib/protokollEditor';
  import type { ProtokollVersandAuswahl, ProtokollVersandPreview } from '../../lib/protokolleView';
  import {
    LIST_RELOADED,
    MAX_EXTRA_RECIPIENTS,
    auswahlBody,
    auswahlCount,
    auswahlDirty,
    isEmailAddress,
    pendingProblem,
    personen,
    refreshAuswahl,
    startAuswahl,
    versandProblem,
  } from '../../lib/protokolleView';
  import type { AbstimmungDetail } from '../../lib/abstimmungen';
  import type { RescueField } from '../../lib/geretteteEingaben';

  /**
   * Invitations and reminders of an Abstimmung: the leaders and members with the label from
   * CampFlow plus addresses added by hand, like the delivery of the minutes. The mails go out
   * one request at a time (`…/mails`), so the page shows the progress.
   */

  interface Props {
    abstimmung: AbstimmungDetail;
    /** After mails went out or were queued; reloads the Abstimmung. */
    onchange: () => void;
  }
  let { abstimmung, onchange }: Props = $props();

  interface MailStand {
    offen: number;
    gesendet: number;
    unklar: number;
  }
  interface EinladungPreview extends ProtokollVersandPreview {
    personen: { name: string; email: string; gruppe: 'leitende' | 'altleitende' | 'weitere' }[];
    eingeladen: string[];
  }

  const LOAD_FAILED =
    'Die Leitenden konnten nicht aus CampFlow geladen werden, es wurde niemand eingeladen. Prüfe deine Internetverbindung und versuche es noch einmal.';

  let auswahl = $state<ProtokollVersandAuswahl | null>(null);
  let vorschlaege = $state<{ name: string; email: string; gruppe: string }[]>([]);
  let eingeladen = $state<string[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');
  /** Mails of the running delivery, while it runs. */
  let fortschritt = $state<MailStand | null>(null);

  const count = $derived(auswahl ? auswahlCount(auswahl) : 0);
  /** Selected addresses already invited or answering here; they get no invitation. */
  const schon = $derived.by(() => {
    if (!auswahl) return 0;
    const { excluded, extra } = auswahl;
    const chosen = [
      ...auswahl.list.map((r) => r.email).filter((email) => !excluded.includes(email)),
      ...extra,
    ];
    return eingeladen.filter((email) => chosen.includes(email)).length;
  });
  const offeneMails = $derived(
    (abstimmung.teilnahmen ?? []).filter((t) => t.mailStatus === 'offen').length
  );
  const erinnerbar = $derived(
    (abstimmung.teilnahmen ?? []).filter(
      (t) =>
        t.email && !t.geantwortet && (t.mailStatus === 'gesendet' || t.mailStatus === 'versucht')
    ).length
  );

  /**
   * The changes to the list, so they survive a new login in the iPhone app: who was taken out
   * (only people still on the list) and which addresses were added.
   */
  const auswahlRettung: RescueField = {
    key: 'Einladung#custom',
    get: () => JSON.stringify({ excluded: auswahl?.excluded ?? [], extra: auswahl?.extra ?? [] }),
    describe: (value) => {
      try {
        const saved = JSON.parse(value) as { excluded?: unknown[]; extra?: unknown[] };
        return `${saved.excluded?.length ?? 0} abgewählt, ${saved.extra?.length ?? 0} hinzugefügt`;
      } catch {
        return 'Auswahl der Empfänger*innen';
      }
    },
    set(value) {
      if (!auswahl) return false;
      let saved: unknown;
      try {
        saved = JSON.parse(value);
      } catch {
        return false;
      }
      const { excluded, extra } = (saved ?? {}) as { excluded?: unknown; extra?: unknown };
      const strings = (list: unknown): string[] =>
        Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
      const listed = new Set(auswahl.list.map((r) => r.email));
      auswahl.excluded = strings(excluded).filter((email) => listed.has(email));
      auswahl.extra = strings(extra)
        .filter((email) => isEmailAddress(email) && !listed.has(email))
        .slice(0, MAX_EXTRA_RECIPIENTS);
      return true;
    },
  };

  function preview(): Promise<EinladungPreview> {
    return sendApi<EinladungPreview>(
      'POST',
      `/intern/pflege/abstimmungen/${abstimmung.id}/einladung`,
      {
        action: 'preview',
      }
    );
  }

  async function start(): Promise<void> {
    loading = true;
    message = null;
    try {
      const loaded = await preview();
      vorschlaege = (loaded.personen ?? []).map((p) => ({
        ...p,
        gruppe: PERSON_GRUPPE_LABELS[p.gruppe],
      }));
      eingeladen = loaded.eingeladen ?? [];
      auswahl = startAuswahl(loaded, false);
      error = null;
    } catch (failure: unknown) {
      messageKind = 'error';
      message = versandProblem(failure, LOAD_FAILED);
    } finally {
      loading = false;
    }
  }

  /** Sends the queued mails one request at a time until none are left. */
  async function deliver(
    art: 'Einladungen' | 'Erinnerungen' | 'Mails',
    start: MailStand = { offen: offeneMails, gesendet: 0, unklar: 0 }
  ): Promise<void> {
    let stand: MailStand = { ...start, offen: Math.max(start.offen, 1) };
    // Shown at once and keeps the buttons locked until the last mail went out
    fortschritt = { ...start, gesendet: 0 };
    try {
      while (stand.offen > 0) {
        stand = await sendApi<MailStand>(
          'POST',
          `/intern/pflege/abstimmungen/${abstimmung.id}/mails`
        );
        fortschritt = stand;
      }
      messageKind = stand.unklar > 0 ? 'warning' : 'success';
      message =
        stand.unklar > 0
          ? `${art} verschickt. Bei ${personen(stand.unklar)} ist unklar, ob die Mail angekommen ist; eine Erinnerung erreicht sie.`
          : `${art} verschickt.`;
    } catch (failure: unknown) {
      messageKind = 'error';
      message = errorMessage(
        failure,
        `Nicht alle ${art} wurden verschickt. Die übrigen warten noch. Tippe später auf „Restliche Mails verschicken“.`
      );
    } finally {
      fortschritt = null;
      onchange();
    }
  }

  async function send(): Promise<void> {
    if (!auswahl) return;
    error = pendingProblem(auswahl);
    if (error) return;
    busy = true;
    let vorgemerkt: MailStand;
    try {
      vorgemerkt = await sendApi<MailStand>(
        'POST',
        `/intern/pflege/abstimmungen/${abstimmung.id}/einladung`,
        { action: 'send', ...auswahlBody(auswahl) }
      );
      auswahl = null;
    } catch (failure: unknown) {
      error = versandProblem(
        failure,
        'Die Einladungen wurden nicht vorbereitet. Es wurde nichts verschickt. Versuche es noch einmal.'
      );
      const reloaded = await preview().catch(() => null);
      if (auswahl && reloaded) {
        const refreshed = refreshAuswahl(auswahl, reloaded);
        auswahl = refreshed.auswahl;
        if (refreshed.changed) error = `${error} ${LIST_RELOADED}`;
      }
      return;
    } finally {
      busy = false;
    }
    await deliver('Einladungen', vorgemerkt);
  }

  async function remind(): Promise<void> {
    const confirmed = await confirmAction({
      title: 'An die Abstimmung erinnern?',
      message: `${personen(erinnerbar)} ${erinnerbar === 1 ? 'hat' : 'haben'} noch nicht abgestimmt und ${erinnerbar === 1 ? 'bekommt' : 'bekommen'} eine Erinnerung mit ihrem persönlichen Link.`,
      confirmLabel: 'Erinnerung schicken',
      tone: 'neutral',
    });
    if (!confirmed) return;
    busy = true;
    message = null;
    let vorgemerkt: MailStand;
    try {
      vorgemerkt = await sendApi<MailStand>(
        'POST',
        `/intern/pflege/abstimmungen/${abstimmung.id}/erinnerung`,
        { action: 'send' }
      );
    } catch (failure: unknown) {
      messageKind = 'error';
      message = errorMessage(
        failure,
        'Die Erinnerung wurde nicht verschickt. Versuche es noch einmal.'
      );
      busy = false;
      return;
    }
    await deliver('Erinnerungen', vorgemerkt);
    busy = false;
  }
</script>

<div class="flex flex-wrap gap-2">
  <ActionButton
    variant="primary"
    disabled={loading || busy || fortschritt !== null || abstimmung.geschlossen}
    aria-busy={loading}
    onclick={() => void start()}
    >{loading ? 'Leitende werden geladen …' : 'Per Mail einladen'}</ActionButton
  >
  {#if erinnerbar > 0}
    <ActionButton
      variant="secondary"
      disabled={busy || fortschritt !== null || abstimmung.geschlossen}
      onclick={() => void remind()}>An Abstimmung erinnern</ActionButton
    >
  {/if}
  {#if offeneMails > 0 && fortschritt === null}
    <ActionButton
      variant="secondary"
      disabled={busy || abstimmung.geschlossen}
      onclick={() => void deliver('Mails')}>Restliche Mails verschicken</ActionButton
    >
  {/if}
</div>

{#if fortschritt}
  <p role="status" class="mt-2 text-sm text-neutral-800">
    Mails werden verschickt … {fortschritt.gesendet} verschickt, {fortschritt.offen} noch offen.
  </p>
{/if}
<StatusNotice {message} kind={messageKind} popup class="mt-2" />

<EditDialog
  open={auswahl !== null}
  title="Zur Abstimmung einladen"
  {busy}
  {error}
  submitLabel={`${personen(Math.max(count - schon, 0))} einladen`}
  busyLabel="Wird vorbereitet …"
  submitDisabled={!auswahl || count - schon <= 0}
  dirty={auswahlDirty(auswahl)}
  rescueKey={`abstimmung-einladung:${abstimmung.id}`}
  rescueFields={[auswahlRettung]}
  onsubmit={() => void send()}
  onclose={() => {
    if (!busy) auswahl = null;
  }}
>
  {#if auswahl}
    <p class="text-sm font-semibold text-neutral-900">„{abstimmung.titel}“</p>
    {#if schon > 0}
      <p class="text-sm text-neutral-700">
        {personen(schon)}
        {schon === 1 ? 'ist' : 'sind'} schon eingeladen oder {schon === 1 ? 'hat' : 'haben'} schon abgestimmt
        und {schon === 1 ? 'bekommt' : 'bekommen'} keine Einladung.
      </p>
    {/if}
    <ProtokollEmpfaenger
      list={auswahl.list}
      bind:excluded={auswahl.excluded}
      bind:extra={auswahl.extra}
      bind:pending={auswahl.pending}
      disabled={busy}
      subject="die Einladung"
      emptyText="In CampFlow wurden keine Leitenden und niemand mit dem Merkmal „Protokollempfang“ mit E-Mail gefunden."
      fieldId="abstimmung-einladung-extra"
      personen={vorschlaege}
    />
  {/if}
</EditDialog>
