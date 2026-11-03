<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import PersonSuche from '../ui/PersonSuche.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import { errorMessage } from '../../lib/api';
  import {
    ladePersonen,
    setzeStatus,
    setzeZustaendigMehrere,
  } from '../../lib/postfachStore.svelte';
  import { STATUS_LABEL } from '../../lib/postfachAnsicht';
  import {
    statusVon,
    type KonversationZeile,
    type PostfachPerson,
    type PostfachStatus,
  } from '../../../../api/lib/postfach-model';

  /**
   * Actions for the conversations chosen in the list: one status or one responsible person for
   * all of them. Each conversation is saved on its own, so one that someone changed meanwhile
   * keeps its state and stays chosen; the result names it.
   */
  interface Props {
    postfach: string;
    zeilen: KonversationZeile[];
    ich: string;
    /** True while saving; the list keeps the choice as it is meanwhile. */
    busy?: boolean;
    /**
     * After a run, with the conversations that stay chosen: those that could not be saved, or
     * all of them when the answer did not come.
     */
    onfertig: (offenGeblieben: string[]) => void;
    onaufheben: () => void;
  }
  let { postfach, zeilen, ich, busy = $bindable(false), onfertig, onaufheben }: Props = $props();

  let meldung = $state<string | null>(null);
  let fehler = $state<string[]>([]);
  let auswahl = $state(false);
  let personen = $state<PostfachPerson[] | null>(null);
  let personenFehler = $state<string | null>(null);
  let query = $state('');

  const anzahl = $derived(zeilen.length);
  const wort = (n: number): string => (n === 1 ? 'E-Mail' : 'E-Mails');

  // A new choice starts without the result of the last one
  let vorige = 0;
  $effect.pre(() => {
    const jetzt = zeilen.length;
    if (vorige === 0 && jetzt > 0) {
      meldung = null;
      fehler = [];
    }
    vorige = jetzt;
  });

  interface Fehlschlag {
    id: string;
    grund: string;
  }

  /** Starts a run on the choice as it is now; the result counts exactly these. */
  function beginnen(): KonversationZeile[] {
    busy = true;
    meldung = null;
    fehler = [];
    return [...zeilen];
  }

  function abschliessen(
    lauf: readonly KonversationZeile[],
    erfolg: string,
    fehlgeschlagen: Fehlschlag[]
  ): void {
    const betreff = (id: string): string =>
      lauf.find((zeile) => zeile.id === id)?.betreff ?? 'E-Mail';
    meldung = erfolg;
    fehler = fehlgeschlagen.map((eintrag) => `„${betreff(eintrag.id)}“: ${eintrag.grund}`);
    busy = false;
    onfertig(fehlgeschlagen.map((eintrag) => eintrag.id));
  }

  async function stand(neu: PostfachStatus): Promise<void> {
    const lauf = beginnen();
    // One after the other, also those that already show this state: the server checks each
    // against what the page shows, so a change by someone else meanwhile is not confirmed
    const fehlgeschlagen: Fehlschlag[] = [];
    for (const zeile of lauf) {
      try {
        await setzeStatus(postfach, zeile.id, neu, statusVon(zeile), zeile.am);
      } catch (error: unknown) {
        fehlgeschlagen.push({
          id: zeile.id,
          grund: errorMessage(error, 'Der Stand konnte nicht gespeichert werden.'),
        });
      }
    }
    const geschafft = lauf.length - fehlgeschlagen.length;
    const ziel =
      neu === 'offen'
        ? 'wieder als offen'
        : neu === 'erledigt'
          ? 'als erledigt'
          : `als „${STATUS_LABEL.kein_handlungsbedarf}“`;
    abschliessen(
      lauf,
      fehlgeschlagen.length
        ? `${geschafft} von ${lauf.length} ${wort(lauf.length)} ${ziel} markiert.`
        : `${geschafft} ${wort(geschafft)} ${ziel} markiert.`,
      fehlgeschlagen
    );
  }

  async function zuweisen(person: PostfachPerson | null): Promise<void> {
    const lauf = beginnen();
    try {
      const { ergebnisse, benachrichtigt } = await setzeZustaendigMehrere(
        postfach,
        person?.login ?? null,
        lauf
      );
      const fehlgeschlagen = ergebnisse
        .filter((ergebnis) => !ergebnis.ok)
        .map((ergebnis) => ({
          id: ergebnis.konversation,
          grund: ergebnis.fehler ?? 'Nicht gespeichert.',
        }));
      const geschafft = ergebnisse.length - fehlgeschlagen.length;
      const teil = fehlgeschlagen.length ? `${geschafft} von ${ergebnisse.length}` : `${geschafft}`;
      auswahl = false;
      query = '';
      abschliessen(
        lauf,
        !person
          ? `Zuständigkeit für ${teil} ${wort(ergebnisse.length)} entfernt.`
          : person.login === ich
            ? `Du bist jetzt für ${teil} ${wort(ergebnisse.length)} zuständig.`
            : `${person.name} ist jetzt für ${teil} ${wort(ergebnisse.length)} zuständig${
                geschafft === 0
                  ? '.'
                  : benachrichtigt
                    ? ' und hat eine Mail bekommen.'
                    : '. Die Mail ging nicht raus; sag bitte selbst Bescheid.'
              }`,
        fehlgeschlagen
      );
    } catch (error: unknown) {
      // Without an answer nobody knows what was saved: the list is read again and shows it
      busy = false;
      fehler = [
        errorMessage(
          error,
          'Die Zuständigkeit konnte nicht gespeichert werden. Die Liste zeigt, was jetzt gilt. Prüfe deine Internetverbindung und versuche es noch einmal.'
        ),
      ];
      onfertig(lauf.map((zeile) => zeile.id));
    }
  }

  async function oeffneAuswahl(): Promise<void> {
    auswahl = true;
    personenFehler = null;
    try {
      personen = await ladePersonen(postfach);
    } catch (error: unknown) {
      personenFehler = errorMessage(
        error,
        'Die Liste der Leitenden konnte nicht geladen werden; dann geht auch das Zuweisen gerade nicht. Versuche es in ein paar Minuten noch einmal. Hilft das nicht, schreib an admin@stamm-phoenix.de.'
      );
    }
  }
</script>

{#if anzahl > 0 || busy || meldung || fehler.length}
  <section
    aria-label="Aktionen für die Auswahl"
    class="space-y-2 border-b border-neutral-200 bg-neutral-100 p-2"
  >
    {#if anzahl > 0}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-semibold text-brand-900" role="status">{anzahl} {wort(anzahl)} ausgewählt</p>
        <button
          type="button"
          class="text-link min-h-11 text-sm underline underline-offset-4 disabled:opacity-60"
          disabled={busy}
          onclick={onaufheben}>Auswahl aufheben</button
        >
      </div>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Stand für die Auswahl">
        <ActionButton disabled={busy} onclick={() => void stand('erledigt')}
          >Als erledigt markieren</ActionButton
        >
        <ActionButton disabled={busy} onclick={() => void stand('kein_handlungsbedarf')}
          >Kein Handlungsbedarf</ActionButton
        >
        <ActionButton disabled={busy} onclick={() => void stand('offen')}>Wieder offen</ActionButton
        >
      </div>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Zuständigkeit für die Auswahl">
        <ActionButton
          variant="primary"
          disabled={busy}
          onclick={() => void zuweisen({ login: ich, name: '' })}>Ich kümmere mich</ActionButton
        >
        <ActionButton disabled={busy} aria-expanded={auswahl} onclick={oeffneAuswahl}
          >Jemandem zuweisen</ActionButton
        >
        <ActionButton disabled={busy} onclick={() => void zuweisen(null)}
          >Zuständigkeit entfernen</ActionButton
        >
      </div>
      {#if auswahl}
        <div>
          <label for="mehrfach-zustaendig" class="text-sm font-semibold text-brand-900"
            >Wer soll sich um die {anzahl}
            {wort(anzahl)} kümmern?</label
          >
          {#if personenFehler}
            <p class="mt-1 text-sm text-danger"><MessageText text={personenFehler} /></p>
          {:else if !personen}
            <p role="status" class="mt-1 text-sm text-neutral-700">Leitende werden geladen …</p>
          {:else}
            <div class="mt-1 flex flex-wrap gap-2">
              <div class="min-w-0 flex-1 basis-56">
                <PersonSuche
                  id="mehrfach-zustaendig"
                  class="form-input w-full"
                  placeholder="Name eingeben, z. B. Lea"
                  listLabel="Zuständige Person wählen"
                  options={personen}
                  disabled={busy}
                  bind:query
                  onpick={(person) => void zuweisen(person)}
                />
              </div>
              <ActionButton
                onclick={() => {
                  auswahl = false;
                  query = '';
                }}>Abbrechen</ActionButton
              >
            </div>
          {/if}
        </div>
      {/if}
    {/if}
    {#if busy}<p role="status" class="text-sm text-neutral-700">Wird gespeichert …</p>{/if}
    {#if meldung}<p role="status" class="text-sm text-success">{meldung}</p>{/if}
    {#if fehler.length}
      <div role="alert" class="text-sm text-danger">
        {#if fehler.length > 1 || meldung}<p>Nicht gespeichert, weiter ausgewählt:</p>{/if}
        <ul class="list-disc pl-5">
          {#each fehler as eintrag, index (index)}<li><MessageText text={eintrag} /></li>{/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}
