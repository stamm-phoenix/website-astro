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
    /** After a run, with the conversations that could not be saved (they stay chosen). */
    onfertig: (offenGeblieben: string[]) => void;
    onaufheben: () => void;
  }

  // A new choice starts without the result of the last one
  let vorige = 0;
  $effect.pre(() => {
    const jetzt = zeilen.length;
    if (vorige === 0 && jetzt > 0 && !busy) {
      meldung = null;
      fehler = [];
    }
    vorige = jetzt;
  });
  let { postfach, zeilen, ich, onfertig, onaufheben }: Props = $props();

  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let fehler = $state<string[]>([]);
  let auswahl = $state(false);
  let personen = $state<PostfachPerson[] | null>(null);
  let personenFehler = $state<string | null>(null);
  let query = $state('');

  const anzahl = $derived(zeilen.length);
  const wort = (n: number): string => (n === 1 ? 'E-Mail' : 'E-Mails');

  function betreff(id: string): string {
    return zeilen.find((zeile) => zeile.id === id)?.betreff ?? 'E-Mail';
  }

  function abschliessen(erfolg: string, fehlgeschlagen: { id: string; grund: string }[]): void {
    meldung = erfolg;
    fehler = fehlgeschlagen.map((eintrag) => `„${betreff(eintrag.id)}“: ${eintrag.grund}`);
    onfertig(fehlgeschlagen.map((eintrag) => eintrag.id));
  }

  async function stand(neu: PostfachStatus): Promise<void> {
    busy = true;
    meldung = null;
    fehler = [];
    // Those already in this state need nothing; the others are saved one after the other
    const zuAendern = zeilen.filter((zeile) => statusVon(zeile) !== neu);
    const fehlgeschlagen: { id: string; grund: string }[] = [];
    for (const zeile of zuAendern) {
      try {
        await setzeStatus(postfach, zeile.id, neu, statusVon(zeile), zeile.am);
      } catch (error: unknown) {
        fehlgeschlagen.push({
          id: zeile.id,
          grund: errorMessage(error, 'Der Stand konnte nicht gespeichert werden.'),
        });
      }
    }
    const geschafft = zeilen.length - fehlgeschlagen.length;
    const ziel =
      neu === 'offen'
        ? 'wieder als offen'
        : neu === 'erledigt'
          ? 'als erledigt'
          : `als „${STATUS_LABEL.kein_handlungsbedarf}“`;
    abschliessen(
      fehlgeschlagen.length
        ? `${geschafft} von ${zeilen.length} ${wort(zeilen.length)} ${ziel} markiert.`
        : `${geschafft} ${wort(geschafft)} ${ziel} markiert.`,
      fehlgeschlagen
    );
    busy = false;
  }

  async function zuweisen(person: PostfachPerson | null): Promise<void> {
    busy = true;
    meldung = null;
    fehler = [];
    try {
      const { ergebnisse, benachrichtigt } = await setzeZustaendigMehrere(
        postfach,
        person?.login ?? null,
        zeilen
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
      fehler = [
        errorMessage(
          error,
          'Die Zuständigkeit konnte nicht gespeichert werden. Nichts wurde geändert. Prüfe deine Internetverbindung und versuche es noch einmal.'
        ),
      ];
    } finally {
      busy = false;
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
          class="text-link min-h-11 text-sm underline underline-offset-4"
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
