<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import PersonSuche from '../ui/PersonSuche.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import { errorMessage } from '../../lib/api';
  import { ApiError } from '../../lib/apiError';
  import { ladePersonen, setzeZustaendig } from '../../lib/postfachStore.svelte';
  import { mailZeitKurz } from '../../lib/postfachAnsicht';
  import type { PostfachPerson, Zustaendigkeit } from '../../../../api/lib/postfach-model';

  /**
   * Who takes care of the conversation: „Ich kümmere mich“ in one tap, or another member of the
   * mailbox's teams through the search. The new person gets a mail, unless it is oneself.
   */
  interface Props {
    postfach: string;
    konversation: string;
    zustaendig: Zustaendigkeit | null;
    ich: string;
    /** After a save, with the conversation it was for and what applies now. */
    onaenderung: (konversation: string, zustaendig: Zustaendigkeit | null) => void;
    /** After a conflict: the page reloads what is current. */
    onkonflikt: (konversation: string) => void;
  }
  let { postfach, konversation, zustaendig, ich, onaenderung, onkonflikt }: Props = $props();

  let auswahl = $state(false);
  let personen = $state<PostfachPerson[] | null>(null);
  let personenFehler = $state<string | null>(null);
  let query = $state('');
  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let fehler = $state<string | null>(null);

  const meins = $derived(zustaendig?.login.toLowerCase() === ich.toLowerCase());
  const optionen = $derived(
    (personen ?? []).filter((person) => person.login !== zustaendig?.login.toLowerCase())
  );

  async function oeffneAuswahl(): Promise<void> {
    auswahl = true;
    meldung = null;
    fehler = null;
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

  async function setze(person: PostfachPerson | null): Promise<void> {
    // The conversation of this request; the answer may come after another one was opened
    const fuer = konversation;
    busy = true;
    meldung = null;
    fehler = null;
    try {
      const result = await setzeZustaendig(
        postfach,
        fuer,
        person?.login ?? null,
        zustaendig?.login ?? null
      );
      onaenderung(fuer, result.zustaendig);
      if (fuer !== konversation) return;
      auswahl = false;
      query = '';
      if (!result.zustaendig) meldung = 'Zuständigkeit entfernt.';
      else if (result.zustaendig.login === ich) meldung = 'Du bist jetzt zuständig.';
      else
        meldung = result.benachrichtigt
          ? `${result.zustaendig.name} ist jetzt zuständig und hat eine Mail bekommen.`
          : `${result.zustaendig.name} ist jetzt zuständig. Die Mail an ${result.zustaendig.name} ging nicht raus; sag bitte selbst Bescheid.`;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) onkonflikt(fuer);
      if (fuer !== konversation) return;
      fehler = errorMessage(
        error,
        'Die Zuständigkeit konnte nicht gespeichert werden. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<section aria-label="Zuständigkeit" class="surface-muted p-3">
  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <p class="min-w-0">
      {#if zustaendig}
        <span class="font-semibold text-brand-900"
          >{meins ? 'Du bist zuständig' : `Zuständig: ${zustaendig.name}`}</span
        >
        <span class="block text-sm text-neutral-700">
          seit {mailZeitKurz(zustaendig.am)}{zustaendig.vonLogin !== zustaendig.login
            ? `, eingetragen von ${zustaendig.vonLogin === ich ? 'dir' : zustaendig.vonName}`
            : ''}
        </span>
      {:else}
        <span class="font-semibold text-warning">Noch niemand zuständig</span>
      {/if}
    </p>
    <div class="flex flex-wrap gap-2">
      {#if !meins}
        <ActionButton
          variant="primary"
          disabled={busy}
          onclick={() => setze({ login: ich, name: '' })}>Ich kümmere mich</ActionButton
        >
      {/if}
      <ActionButton disabled={busy} aria-expanded={auswahl} onclick={oeffneAuswahl}
        >{zustaendig ? 'Jemand anderem zuweisen' : 'Jemandem zuweisen'}</ActionButton
      >
      {#if zustaendig}
        <ActionButton disabled={busy} onclick={() => setze(null)}
          >{meins ? 'Nicht mehr zuständig' : 'Zuständigkeit entfernen'}</ActionButton
        >
      {/if}
    </div>
  </div>

  {#if auswahl}
    <div class="mt-3">
      <label for="zustaendig-suche-{konversation}" class="text-sm font-semibold text-brand-900"
        >Wer soll sich kümmern?</label
      >
      {#if personenFehler}
        <p class="mt-1 text-sm text-danger"><MessageText text={personenFehler} /></p>
      {:else if !personen}
        <p role="status" class="mt-1 text-sm text-neutral-700">Leitende werden geladen …</p>
      {:else}
        <div class="mt-1 flex flex-wrap gap-2">
          <div class="min-w-0 flex-1 basis-56">
            <PersonSuche
              id="zustaendig-suche-{konversation}"
              class="form-input w-full"
              placeholder="Name eingeben, z. B. Lea"
              listLabel="Zuständige Person wählen"
              options={optionen}
              disabled={busy}
              bind:query
              onpick={(person) => setze(person)}
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

  {#if meldung}<p role="status" class="mt-2 text-sm text-success">{meldung}</p>{/if}
  {#if fehler}<p role="alert" class="mt-2 text-sm text-danger">
      <MessageText text={fehler} />
    </p>{/if}
</section>
