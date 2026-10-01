<script lang="ts">
  import { untrack } from 'svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { ApiError, fetchApi, sendApi } from '../../lib/api';
  import type {
    SammelBestellung,
    SammelBillingPerson,
    SammelPaymentView,
    SammelPaymentPreview,
    SammelPaymentEvent,
  } from '../../lib/types';

  interface Props {
    order: SammelBestellung | null;
    onclose: () => void;
    onupdate: (order: SammelBestellung) => void;
    onprepare: (order: SammelBestellung) => void;
    automaticTotalCents: number | null;
    archived: boolean;
  }
  let { order, onclose, onupdate, onprepare, automaticTotalCents, archived }: Props = $props();
  let view = $state<SammelPaymentView | null>(null);
  let persons = $state<SammelBillingPerson[]>([]);
  let preview = $state<SammelPaymentPreview | null>(null);
  let mode = $state<'inspect' | 'assign' | 'review' | 'adopt' | 'dispatch'>('inspect');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let fields = $state<Record<string, string>>({});
  let notice = $state<string | null>(null);
  let search = $state('');
  let personId = $state('');
  let reason = $state('');
  let feeId = $state('');
  let reference = $state('');
  let evidence = $state('');
  let confirmed = $state(false);
  let executionEnded = $state(false);
  let revision = 0;
  const operation = $derived(view?.record?.operation);
  const needsPreparation = $derived(
    !operation &&
      !!view &&
      (!['Bestellt', 'Eingetroffen'].includes(view.order.status) || view.order.totalCents === null)
  );
  const unavailable = $derived(
    !operation && !!view && (archived || view.order.paid || !view.order.submitted)
  );
  const matching = $derived(persons.filter((person) => person.matchesEmail));
  const candidates = $derived(
    search.trim()
      ? persons.filter((person) =>
          `${person.name} ${person.emails.join(' ')}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        )
      : matching
  );
  const selectedPerson = $derived(persons.find((person) => person.id === personId));
  const label = $derived(
    mode === 'assign'
      ? 'Person bestätigen'
      : mode === 'adopt'
        ? 'Beitrag zuordnen'
        : mode === 'dispatch'
          ? 'Versand bestätigen'
          : mode === 'review'
            ? view?.creationEnabled
              ? 'Beitrag anlegen'
              : 'Beitrag zuordnen'
            : operation?.state === 'created'
              ? 'Fertig'
              : operation && operation.state !== 'prepared'
                ? 'Beitrag zuordnen'
                : needsPreparation
                  ? 'Bestellung vorbereiten'
                  : 'Beitrag vorbereiten'
  );
  const money = (amount: number | null): string =>
    amount === null
      ? 'Betrag noch offen'
      : (amount / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const date = (value: string): string =>
    new Date(value).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const eventNames: Record<SammelPaymentEvent['action'], string> = {
    assigned: 'Person bestätigt',
    prepared: 'Beitrag vorbereitet',
    attempted: 'Erstellung versucht',
    created: 'Beitrag angelegt',
    uncertain: 'Ergebnis unklar',
    adopted: 'Vorhandener Beitrag zugeordnet',
    dispatched: 'Versand manuell bestätigt',
    settled: 'Zahlungsmarkierung geändert',
  };
  function base(id: string): string {
    return `/intern/pflege/sammelbestellungen/orders/${id}/payment`;
  }
  function failure(caught: unknown): void {
    fields = caught instanceof ApiError ? (caught.fields ?? {}) : {};
    error =
      Object.values(fields).join(' ') ||
      (caught instanceof Error
        ? caught.message
        : 'Die Zahlungsdaten konnten nicht geladen werden.');
  }
  function changeMode(next: typeof mode): void {
    notice = null;
    mode = next;
    error = null;
    fields = {};
    confirmed = false;
    executionEnded = false;
    evidence = '';
  }
  async function load(id: string): Promise<void> {
    const version = ++revision;
    busy = true;
    view = null;
    preview = null;
    persons = [];
    error = null;
    fields = {};
    notice = null;
    search = '';
    personId = '';
    reason = '';
    feeId = '';
    reference = '';
    confirmed = false;
    executionEnded = false;
    try {
      const result = await fetchApi<SammelPaymentView>(base(id));
      if (version !== revision) return;
      view = result;
      mode = result.record ? 'inspect' : 'assign';
      if (!result.record) await loadPersons(id);
    } catch (caught) {
      if (version === revision) failure(caught);
    } finally {
      if (version === revision) busy = false;
    }
  }
  async function loadPersons(id: string): Promise<void> {
    persons = await fetchApi<SammelBillingPerson[]>(`${base(id)}/persons`);
    personId =
      view?.record?.assignment.person.id ??
      (persons.filter((person) => person.matchesEmail).length === 1
        ? persons.find((person) => person.matchesEmail)!.id
        : '');
    reason = view?.record?.assignment.reason ?? '';
  }
  $effect(() => {
    const id = order?.id;
    untrack(() => {
      if (id) void load(id);
      else {
        revision++;
        view = null;
      }
    });
  });
  async function choosePerson(): Promise<void> {
    if (!order || busy) return;
    busy = true;
    try {
      await loadPersons(order.id);
      changeMode('assign');
    } catch (caught) {
      failure(caught);
    } finally {
      busy = false;
    }
  }
  async function review(next: 'review' | 'adopt'): Promise<void> {
    if (!view || !order || busy) return;
    busy = true;
    error = null;
    try {
      preview = await sendApi<SammelPaymentPreview>('POST', base(order.id), {
        action: 'preview',
        etag: view.order.etag,
      });
      changeMode(next);
    } catch (caught) {
      failure(caught);
    } finally {
      busy = false;
    }
  }
  async function submit(): Promise<void> {
    if (!view || !order || busy) return;
    if (mode === 'inspect') {
      if (unavailable) return;
      if (needsPreparation) {
        onprepare(view.order);
        return;
      }
      if (operation?.state === 'created') {
        onclose();
        return;
      }
      await review(operation && operation.state !== 'prepared' ? 'adopt' : 'review');
      return;
    }
    if (mode === 'review' && !view.creationEnabled) {
      changeMode('adopt');
      return;
    }
    if (!confirmed || (mode === 'adopt' && !executionEnded)) {
      error = 'Bitte die Angaben prüfen und die Bestätigung ankreuzen.';
      return;
    }
    busy = true;
    error = null;
    fields = {};
    notice = null;
    const action =
      mode === 'assign'
        ? 'assign'
        : mode === 'review'
          ? 'create'
          : mode === 'adopt'
            ? 'adopt'
            : 'dispatched';
    try {
      view = await sendApi<SammelPaymentView>('POST', base(order.id), {
        action,
        etag: view.order.etag,
        personId,
        reason,
        hash: preview?.hash,
        feeId,
        reference,
        evidence,
        confirmed,
        executionEnded,
      });
      onupdate(view.order);
      changeMode('inspect');
      notice =
        action === 'assign'
          ? 'Person bestätigt. Prüfe jetzt den endgültigen Betrag.'
          : action === 'create'
            ? 'Beitrag angelegt. Bitte den Versand der Zahlungsaufforderung in CampFlow prüfen.'
            : action === 'adopt'
              ? 'Geprüfter Beitrag zugeordnet.'
              : 'Versand als manuell bestätigt gespeichert.';
    } catch (caught) {
      failure(caught);
      // Even a lost success response may have changed durable state. Reload before another action.
      try {
        const result = await fetchApi<SammelPaymentView>(base(order.id));
        view = result;
        onupdate(result.order);
        preview = null;
        mode = result.record ? 'inspect' : 'assign';
        confirmed = false;
        executionEnded = false;
      } catch {
        view = null;
        error = `${error} Zahlungsstand nicht erreichbar. Bitte schließen und neu laden.`;
      }
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={order !== null}
  title="Bezahlung über CampFlow"
  {busy}
  {error}
  submitDisabled={mode === 'inspect' && unavailable}
  submitLabel={view ? label : 'Schließen'}
  busyLabel="Wird geprüft …"
  cancelLabel="Schließen"
  {onclose}
  onsubmit={() => (view ? void submit() : onclose())}
>
  {#if view}
    <header class="border-b border-neutral-200 pb-5">
      <p class="text-sm text-neutral-700">{view.order.name} · Bestellung {view.order.id}</p>
      <p class="mt-2 font-serif text-4xl tracking-tight text-brand-900 tabular-nums">
        {money(operation?.snapshot.amount ?? view.order.totalCents ?? automaticTotalCents)}
      </p>
      <p class="mt-2 text-sm text-neutral-700">
        {view.order.totalCents === null && !operation
          ? automaticTotalCents === null
            ? 'Die Artikelsumme ist unvollständig. Trage beim Vorbereiten den vollständigen Gesamtbetrag einschließlich Versand ein.'
            : 'Berechnete Artikelsumme. Wird beim Vorbereiten übernommen, sofern du keinen eigenen Gesamtbetrag einträgst. Versandkosten bei Bedarf ergänzen.'
          : 'Gespeicherter Gesamtbetrag einschließlich eingetragener Versandkosten.'}
      </p>
    </header>
    <StatusNotice message={notice} />
    {#if mode === 'assign'}
      <section aria-labelledby="billing-person-heading" class="space-y-4">
        <h3 id="billing-person-heading" class="font-serif text-xl text-brand-900">
          Wer trägt den Beitrag?
        </h3>
        <p class="text-sm text-neutral-700">
          Die gesamte Bestellung wird einer Person zugeordnet, auch bei einer gemeinsamen
          Familienadresse. Bestelladresse: <span class="break-all">{view.order.email}</span>
        </p>
        {#if matching.length > 1}<p class="text-sm text-brand-900">
            Mehrere Mitglieder nutzen diese Adresse. Bitte die zuständige Person auswählen.
          </p>{/if}
        <FormField
          id="billing-search"
          label="Mitglied suchen"
          optional
          hint="Ohne Suche werden passende E-Mail-Adressen angezeigt."
        >
          {#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              type="search"
              bind:value={search}
              placeholder="Name oder E-Mail-Adresse"
            />{/snippet}
        </FormField>
        <FormField id="billing-person" label="CampFlow-Person" error={fields.personId}>
          {#snippet children(attrs)}<select {...attrs} class="form-input" bind:value={personId}>
              <option value="">Bitte auswählen</option>
              {#if selectedPerson && !candidates.some((person) => person.id === selectedPerson.id)}<option
                  value={selectedPerson.id}>{selectedPerson.name}</option
                >{/if}
              {#each candidates as person (person.id)}<option value={person.id}
                  >{person.name} · {person.emails.join(', ') || 'Keine E-Mail-Adresse'}</option
                >{/each}
            </select>{/snippet}
        </FormField>
        {#if !candidates.length}<p class="text-sm text-neutral-700">
            Keine passenden Mitglieder. Suche nach einem Namen oder nutze weiter die manuelle
            Bezahlung.
          </p>{/if}
        {#if selectedPerson && !selectedPerson.matchesEmail}
          <FormField
            id="billing-reason"
            label="Warum weicht die Kontaktadresse ab?"
            error={fields.reason}
          >
            {#snippet children(attrs)}<textarea
                {...attrs}
                class="form-input"
                rows="2"
                maxlength="1000"
                bind:value={reason}></textarea>{/snippet}
          </FormField>
        {/if}
        <label class="flex items-start gap-3 text-sm text-brand-900"
          ><input type="checkbox" class="mt-1" bind:checked={confirmed} />Die ausgewählte Person
          soll den gesamten Beitrag dieser Bestellung tragen.</label
        >
      </section>
    {:else if mode === 'review' || mode === 'adopt'}
      <dl class="grid gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">
        <dt class="text-neutral-700">CampFlow-Person</dt>
        <dd class="font-semibold text-brand-900">{preview?.personName}</dd>
        <dt class="text-neutral-700">Beschreibung</dt>
        <dd class="break-words text-brand-900">{preview?.snapshot.description}</dd>
      </dl>
      {#if mode === 'review'}
        <p class="text-sm text-neutral-700">
          Mit der Erstellung werden Betrag, Person und Artikel gesperrt. Den Versand der
          Zahlungsaufforderung prüfst du anschließend im CampFlow-Dashboard und verschickst sie dort
          bei Bedarf. Den Bezahlstatus pflegst du auf der Website manuell.
        </p>
        {#if !view.creationEnabled}<p class="text-sm text-neutral-700">
            Die Beitragserstellung auf der Website ist noch nicht freigeschaltet. Du kannst einen
            bereits in CampFlow angelegten Beitrag zuordnen.
          </p>
        {:else}<label class="flex items-start gap-3 text-sm text-brand-900"
            ><input class="mt-1" type="checkbox" bind:checked={confirmed} />Person und endgültiger
            Betrag sind geprüft. Für diese Bestellung existiert noch kein Beitrag in CampFlow. Ich
            bestätige die Erstellung.</label
          >{/if}
        {#if view.creationEnabled}<button
            type="button"
            class="text-sm font-semibold text-brand-800 underline underline-offset-4"
            onclick={() => changeMode('adopt')}>Vorhandenen Beitrag zuordnen</button
          >{/if}
      {:else}
        <p class="text-sm text-neutral-700">
          Prüfe in CampFlow die Person, den Betrag und die Bestellnummer. Diese Zuordnung wird
          manuell geprüft und protokolliert. Die Website legt dabei keinen Beitrag an.
        </p>
        {#if operation?.attemptedAt}<p class="text-sm text-[var(--color-dpsg-red)]">
            Erstellungsversuch vom {date(operation.attemptedAt)}. Bevor du einen Beitrag zuordnest,
            muss feststehen, dass dieser Versuch beendet ist. Bei Unklarheit CampFlow-Support
            fragen. Keinen weiteren Beitrag anlegen.
          </p>{/if}
        <FormField
          id="billing-fee"
          label="CampFlow-Beitrags-ID"
          error={fields.feeId}
          hint="Die ID beginnt mit fee_. Sie ist nicht die Zahlungsreferenz."
          >{#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              maxlength="255"
              bind:value={feeId}
              placeholder="fee_…"
            />{/snippet}</FormField
        >
        <FormField id="billing-reference" label="Zahlungsreferenz" error={fields.reference}
          >{#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              maxlength="100"
              bind:value={reference}
            />{/snippet}</FormField
        >
        <FormField
          id="billing-evidence"
          label="Nachweis der Prüfung"
          error={fields.evidence}
          hint="Zum Beispiel Prüfdatum und der Abgleich von Person, Betrag und Bestellnummer. Keine Bankdaten eintragen."
          >{#snippet children(attrs)}<textarea
              {...attrs}
              class="form-input"
              rows="3"
              maxlength="1000"
              bind:value={evidence}></textarea>{/snippet}</FormField
        >
        <label class="flex items-start gap-3 text-sm text-brand-900"
          ><input class="mt-1" type="checkbox" bind:checked={executionEnded} />Es läuft kein alter
          Erstellungsversuch mehr.</label
        >
        <label class="flex items-start gap-3 text-sm text-brand-900"
          ><input class="mt-1" type="checkbox" bind:checked={confirmed} />Der vorhandene Beitrag
          gehört zur angegebenen Person und hat genau diesen Betrag. Ich habe die Zuordnung in
          CampFlow geprüft.</label
        >
      {/if}
    {:else if mode === 'dispatch'}
      <h3 class="font-serif text-xl text-brand-900">Zahlungsaufforderung verschickt?</h3>
      <p class="text-sm text-neutral-700">
        Öffne den Beitrag in CampFlow und prüfe, ob die Zahlungsaufforderung bereits verschickt
        wurde. Verschicke sie dort bei Bedarf. Prüfe die tatsächlichen Empfänger einschließlich
        CC-Adressen. Die Website sendet bei dieser Bestätigung keine Nachricht.
      </p>
      <FormField
        id="dispatch-evidence"
        label="Versandnachweis"
        error={fields.evidence}
        hint="Wann und an wen wurde die Zahlungsaufforderung in CampFlow verschickt?"
        >{#snippet children(attrs)}<textarea
            {...attrs}
            class="form-input"
            rows="3"
            maxlength="1000"
            bind:value={evidence}></textarea>{/snippet}</FormField
      >
      <label class="flex items-start gap-3 text-sm text-brand-900"
        ><input class="mt-1" type="checkbox" bind:checked={confirmed} />Die Zahlungsaufforderung
        wurde im CampFlow-Dashboard verschickt.</label
      >
    {:else}
      <dl class="grid gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">
        <dt class="text-neutral-700">CampFlow-Person</dt>
        <dd class="font-semibold text-brand-900">{view.record?.assignment.person.name}</dd>
        {#if operation?.contribution}<dt class="text-neutral-700">Zahlungsreferenz</dt>
          <dd class="font-semibold break-all text-brand-900">{operation.contribution.reference}</dd>
          <dt class="text-neutral-700">Beitrags-ID</dt>
          <dd class="break-all text-neutral-700">{operation.contribution.id}</dd>{/if}
        <dt class="text-neutral-700">Zahlungsaufforderung</dt>
        <dd>
          {view.record?.dispatch
            ? `Manuell bestätigt am ${date(view.record.dispatch.confirmedAt)}`
            : operation?.state === 'created'
              ? 'Versand in CampFlow noch nicht bestätigt'
              : 'Noch kein Beitrag angelegt'}
        </dd>
        <dt class="text-neutral-700">Bezahlung</dt>
        <dd>
          {view.order.paid ? 'Bezahlt' : 'Noch offen'}{view.record?.settlement
            ? ` · Manuell geprüft am ${date(view.record.settlement.markedAt)}`
            : ' · Manuell gepflegt'}
        </dd>
      </dl>
      {#if operation?.state === 'attempted' || operation?.state === 'uncertain'}
        <p
          role="status"
          class="border-l-2 border-[var(--color-dpsg-red)] pl-4 text-sm text-[var(--color-dpsg-red)]"
        >
          Ergebnis unklar. Vor einem weiteren Versuch in CampFlow prüfen. Die Website sperrt die
          erneute Erstellung. Ein fehlender Suchtreffer reicht nicht aus, um einen neuen Beitrag
          anzulegen.
        </p>
      {:else if operation?.state === 'prepared'}<p class="text-sm text-neutral-700">
          Der Beitrag ist vorbereitet. Der Aufruf an CampFlow wurde noch nicht reserviert. Prüfe die
          Daten, um fortzufahren.
        </p>
      {:else if operation?.state === 'created'}<p class="text-sm text-neutral-700">
          Betrag, Person und Artikel sind gesperrt. Zahlungen kannst du unter „Status bearbeiten“
          manuell markieren. Korrekturen oder Stornierungen bitte zuerst in CampFlow klären.
        </p>
      {:else if unavailable}<p role="status" class="text-sm text-neutral-700">
          {archived
            ? 'Die Aktion ist archiviert.'
            : view.order.paid
              ? 'Die Bestellung ist bereits bezahlt.'
              : 'Die Bestellung wurde noch nicht eingereicht.'}
          Dafür kann kein neuer Beitrag angelegt werden.
        </p>
      {:else if needsPreparation}<p role="status" class="text-sm text-neutral-700">
          Noch kein Beitrag angelegt. Wähle „Bestellung vorbereiten“, um den Status auf „Bestellt“
          oder „Eingetroffen“ zu setzen und den Gesamtbetrag zu speichern.
          {automaticTotalCents === null && view.order.totalCents === null
            ? 'Es fehlen Artikelpreise. Trage den vollständigen Gesamtbetrag selbst ein.'
            : 'Die Artikelsumme wird vorbelegt, wenn noch kein eigener Betrag gespeichert ist.'}
        </p>
      {:else}<p class="text-sm text-neutral-700">
          Noch kein Beitrag angelegt. Mit „Beitrag vorbereiten“ kontrollierst du Betrag und Person.
          Erst die anschließende Bestätigung „Beitrag anlegen“ erstellt ihn in CampFlow.
        </p>{/if}
      <div class="flex flex-wrap gap-x-5 gap-y-3">
        {#if !operation}<button
            type="button"
            class="text-sm font-semibold text-brand-800 underline underline-offset-4"
            disabled={busy}
            onclick={() => void choosePerson()}>Person ändern</button
          >{/if}
        {#if operation?.state === 'created' && !view.record?.dispatch}<button
            type="button"
            class="btn-secondary"
            onclick={() => changeMode('dispatch')}>Versand bestätigen</button
          >{/if}
      </div>
    {/if}
    {#if view.events.length && mode === 'inspect'}
      <details class="border-t border-neutral-200 pt-4">
        <summary class="cursor-pointer text-sm font-semibold text-brand-900"
          >Zahlungsverlauf</summary
        >
        <ol class="mt-3 divide-y divide-neutral-200">
          {#each view.events as event, index (index)}<li class="py-3 text-sm">
              <p class="font-semibold text-brand-900">{eventNames[event.action]}</p>
              <p class="break-words text-xs text-neutral-700">
                {date(event.at)} · {event.actor.name}
              </p>
              {#if event.evidence}<p class="mt-1 break-words whitespace-pre-line text-neutral-700">
                  {event.evidence}
                </p>{/if}
            </li>{/each}
        </ol>
      </details>
    {/if}
  {:else if busy}<p role="status" aria-live="polite" class="py-6 text-neutral-700">
      Zahlungsstand wird geladen …
    </p>{/if}
</EditDialog>
