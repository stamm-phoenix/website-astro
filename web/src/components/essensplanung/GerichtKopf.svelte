<script lang="ts">
  import { untrack } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import TagInput from '../pflege/TagInput.svelte';
  import LazyTextEditor from '../ui/LazyTextEditor.svelte';
  import { ApiError } from '../../lib/api';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { nachDemTippen } from '../../lib/nachDemTippen';
  import type { Gericht } from '../../../../api/lib/essen-gerichte-model';
  import GerichtKopfHinweise from './GerichtKopfHinweise.svelte';
  import GerichtLinksFeld from './GerichtLinksFeld.svelte';
  import {
    FELD_NAMEN,
    KOPF_FELDER,
    gleich,
    kopfVon,
    nachFehler,
    schritt,
    sendewert,
    textVon,
    uebernommen,
    vergleichswert,
    type KopfFeld,
  } from './gerichtKopf';
  import { meldeVerloren, merkeSpeichern, type PlanKontext } from './planKontext';

  /**
   * The fields of a dish for those who edit. Each field saves on its own as soon as it is left
   * (a tool or a removed link at once), so the others see it right away. A field keeps the
   * version it was typed on: when someone else saved the same field meanwhile, it warns and
   * saves only on „Trotzdem speichern“; changes of others to other fields come in as they are.
   * A field whose save failed says so under the fields, with a button to save it again.
   */

  interface Props {
    kontext: PlanKontext;
    gericht: Gericht;
    /** False while read-only (maintenance): the form hides, its input stays. */
    bearbeiten: boolean;
    /** True once the card was shown, so the editor of the instructions loads. */
    editorGeladen: boolean;
    /** Whether the page deletes the dish itself, which needs no word about lost input. */
    selbstGeloescht: () => boolean;
  }
  let { kontext, gericht, bearbeiten, editorGeladen, selbstGeloescht }: Props = $props();

  /** The saved fields each field started from, and the input. */
  let basis = $state(kopfVon(untrack(() => gericht)));
  let kopf = $state(kopfVon(untrack(() => gericht)));
  let felder = $state<Record<string, string>>({});
  /** Fields someone else saved under the typed input; they save only when asked to. */
  let konflikte = $state<KopfFeld[]>([]);
  /** Fields whose save failed (no connection, a refused value); the input stays. */
  let ungespeichert = $state<KopfFeld[]>([]);
  /** A tool name typed but not yet added. */
  let werkzeugEntwurf = $state('');
  /** The field that has the focus; a change of others does not replace it under the cursor. */
  let fokusFeld = $state<KopfFeld | null>(null);

  const aktuellVon = (feld: KopfFeld) => kopfVon(gericht)[feld];
  /** Empty rows of links are no input: they are never sent. */
  const geaendert = (feld: KopfFeld): boolean =>
    !gleich(vergleichswert(feld, kopf[feld]), vergleichswert(feld, basis[feld]));
  /** Whether a field holds input; a function too, as a derived read when the card goes may be stale. */
  const offen = (): boolean => KOPF_FELDER.some(geaendert) || werkzeugEntwurf.trim() !== '';
  $effect(() => guardUnsavedChanges(offen));

  /** Takes the saved value into a field, as its basis and into the input. */
  function nimm(feld: KopfFeld, aktuell = aktuellVon(feld)): void {
    basis = { ...basis, [feld]: aktuell };
    kopf = { ...kopf, [feld]: uebernommen(feld, aktuell, kopf[feld]) };
  }
  const ohne = (liste: KopfFeld[], feld: KopfFeld) => liste.filter((f) => f !== feld);

  // Fields without input follow the saved state, also those of others
  $effect(() => {
    const neu = kopfVon(gericht);
    untrack(() => {
      for (const feld of KOPF_FELDER)
        if (!geaendert(feld) && fokusFeld !== feld) nimm(feld, neu[feld]);
    });
  });

  // While read-only the form is gone, so is its focus; afterwards input left there is saved
  let warBearbeiten = untrack(() => bearbeiten);
  $effect(() => {
    const jetzt = bearbeiten;
    untrack(() => {
      if (!jetzt) fokusFeld = null;
      else if (!warBearbeiten)
        for (const feld of KOPF_FELDER)
          if (geaendert(feld) && !konflikte.includes(feld)) speichernSpaeter(feld);
      warBearbeiten = jetzt;
    });
  });

  /** The save that runs; a further one waits for it and then starts from its result. */
  let lauf: Promise<boolean> | null = null;

  /** Saves one field if it changed; whether it is saved afterwards. */
  async function speichern(feld: KopfFeld, bewusst = false): Promise<boolean> {
    while (lauf) await lauf;
    lauf = speichernJetzt(feld, bewusst);
    try {
      return await lauf;
    } finally {
      lauf = null;
    }
  }

  function fehlerWeg(feld: KopfFeld): void {
    felder = Object.fromEntries(
      Object.entries(felder).filter(([key]) => key !== feld && !key.startsWith(`${feld}.`))
    );
  }

  async function speichernJetzt(
    feld: KopfFeld,
    bewusst: boolean,
    nochmal = true
  ): Promise<boolean> {
    const geprueft = basis[feld];
    const jetzt = aktuellVon(feld);
    const war = konflikte.includes(feld);
    const was = schritt(
      vergleichswert(feld, kopf[feld]),
      vergleichswert(feld, geprueft),
      vergleichswert(feld, jetzt),
      { konflikt: war, bewusst }
    );
    if (was !== 'senden') ungespeichert = ohne(ungespeichert, feld);
    if (was === 'nichts') {
      // Also a warning goes once the input says what is saved; a change of others that came in
      // while the field had the focus shows now
      konflikte = ohne(konflikte, feld);
      fehlerWeg(feld);
      nimm(feld, jetzt);
      return true;
    }
    if (was === 'konflikt') {
      // Someone else saved this field meanwhile: keep the input and let the person decide
      if (!war) {
        basis = { ...basis, [feld]: jetzt };
        konflikte = [...konflikte, feld];
      }
      return false;
    }
    konflikte = ohne(konflikte, feld);
    // The errors of the last try go; what the server still refuses comes back with its answer
    fehlerWeg(feld);
    // The version checked against; a change of others while this waits makes the server refuse it
    const geprueftEtag = gericht.etag;
    let etagGesendet = geprueftEtag;
    const gesendet = vergleichswert(feld, $state.snapshot(kopf[feld]));
    const { wert, linkIndex } = sendewert(feld, $state.snapshot(kopf));
    const name = feld === 'name' && kopf.name.trim() ? kopf.name.trim() : gericht.name;
    const ok = await kontext.aendern(async () => {
      // In the queue, the newest version counts as long as this field is still as checked
      etagGesendet = bewusst || gleich(aktuellVon(feld), geprueft) ? gericht.etag : geprueftEtag;
      try {
        return await kontext.api.senden('PATCH', `/gerichte/${gericht.id}`, {
          etag: etagGesendet,
          [feld]: wert,
        });
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields)
          felder = {
            ...felder,
            ...Object.fromEntries(
              Object.entries(error.fields).map(([key, text]) => [
                key.replace(/^links\.(\d+)\./, (_, i) => `links.${linkIndex[Number(i)] ?? i}.`),
                text,
              ])
            ),
          };
        throw error;
      }
    }, `${name} gespeichert.`);
    const aktuell = aktuellVon(feld);
    if (ok) {
      ungespeichert = ohne(ungespeichert, feld);
      fehlerWeg(feld);
      // Typed on while it saved: that input stays as a draft
      if (gleich(vergleichswert(feld, kopf[feld]), gesendet)) nimm(feld, aktuell);
      else basis = { ...basis, [feld]: aktuell };
      return true;
    }
    // A failed „Trotzdem speichern“ keeps the choice under the fields
    const folge = bewusst ? 'konflikt' : nachFehler(aktuell, geprueft, etagGesendet, gericht.etag);
    if (folge === 'nochmal' && nochmal) {
      // Only another field changed: the field goes again with the new version
      basis = { ...basis, [feld]: aktuell };
      return speichernJetzt(feld, false, false);
    }
    if (folge === 'konflikt') {
      basis = { ...basis, [feld]: aktuell };
      konflikte = [...ohne(konflikte, feld), feld];
    } else if (!ungespeichert.includes(feld)) ungespeichert = [...ungespeichert, feld];
    return false;
  }

  /** Saves a field after the click of the tap that left it, noted for actions that wait. */
  function speichernSpaeter(feld: KopfFeld): void {
    nachDemTippen(() => merkeSpeichern(speichern(feld)));
  }

  function feldVon(element: EventTarget | null): KopfFeld | null {
    if (!(element instanceof Element)) return null;
    const feld = element.closest<HTMLElement>('[data-feld]')?.dataset.feld;
    return KOPF_FELDER.find((f) => f === feld) ?? null;
  }

  /** Leaving a field saves it; moving inside it (a link's title to its address) does not. */
  function verlassen(event: FocusEvent): void {
    const feld = feldVon(event.target);
    if (!feld || feldVon(event.relatedTarget) === feld) return;
    if (fokusFeld === feld) fokusFeld = null;
    speichernSpaeter(feld);
  }

  /**
   * Enter in a one-line field saves it, also over a change of others it warned about. The form
   * has no submit button, so the browser would not send it on Enter; the tools take Enter
   * themselves to add the typed one.
   */
  function taste(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return;
    if (!(event.target instanceof HTMLInputElement)) return;
    const feld = feldVon(event.target);
    if (!feld || feld === 'werkzeuge') return;
    event.preventDefault();
    void speichern(feld, konflikte.includes(feld));
  }

  function verwerfen(feld: KopfFeld): void {
    nimm(feld);
    konflikte = ohne(konflikte, feld);
    ungespeichert = ohne(ungespeichert, feld);
    fehlerWeg(feld);
  }

  // Someone else deleted the dish: the card goes, so the unsaved fields are shown to copy
  $effect(() => () => {
    if (selbstGeloescht() || !offen()) return;
    const eingaben = KOPF_FELDER.filter(geaendert)
      .map((feld) => `${FELD_NAMEN[feld]}: ${textVon(vergleichswert(feld, kopf[feld]))}`)
      .concat(werkzeugEntwurf.trim() ? [`${FELD_NAMEN.werkzeuge}: ${werkzeugEntwurf.trim()}`] : [])
      .join(' · ');
    meldeVerloren(
      kontext,
      `„${gericht.name}“ wurde gerade gelöscht. Deine ungespeicherten Eingaben: ${eingaben}`
    );
  });
</script>

{#if bearbeiten}
  <form
    class="space-y-3 print:hidden"
    onsubmit={(event) => event.preventDefault()}
    onfocusin={(event) => (fokusFeld = feldVon(event.target))}
    onfocusout={verlassen}
  >
    <div class="grid gap-x-6 gap-y-3 lg:grid-cols-2">
      <div class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div data-feld="name">
            <FormField id="gericht-{gericht.id}-name" label="Name" error={felder.name}>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  class="form-input"
                  maxlength="150"
                  bind:value={kopf.name}
                  onkeydown={taste}
                />
              {/snippet}
            </FormField>
          </div>
          <div data-feld="personen">
            <FormField
              id="gericht-{gericht.id}-personen"
              label="Personen"
              error={felder.personen}
              info="Für so viele Personen gelten die Mengen und wachsen mit den Essern. Leer gelten sie fest für jede Einplanung, z. B. 2 Brote fürs Frühstück."
            >
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  class="form-input"
                  inputmode="numeric"
                  placeholder="leer: feste Mengen"
                  bind:value={kopf.personen}
                  onkeydown={taste}
                />
              {/snippet}
            </FormField>
          </div>
        </div>
        <div data-feld="werkzeuge">
          <FormField
            id="gericht-{gericht.id}-werkzeuge"
            label="Werkzeuge"
            optional
            error={felder.werkzeuge}
          >
            {#snippet children(attrs)}
              <TagInput
                id={attrs.id}
                tags={kopf.werkzeuge}
                placeholder="z. B. Pürierstab"
                kompakt
                onchange={(werkzeuge) => {
                  kopf.werkzeuge = werkzeuge;
                  speichernSpaeter('werkzeuge');
                }}
                ondraftchange={(text) => (werkzeugEntwurf = text)}
              />
            {/snippet}
          </FormField>
        </div>
        <GerichtLinksFeld
          gerichtId={gericht.id}
          bind:links={kopf.links}
          {felder}
          onkeydown={taste}
          onentfernen={(index) => {
            kopf.links.splice(index, 1);
            fehlerWeg('links');
            speichernSpaeter('links');
          }}
        />
        <div data-feld="notiz">
          <FormField id="gericht-{gericht.id}-notiz" label="Notiz" optional error={felder.notiz}>
            {#snippet children(attrs)}
              <textarea {...attrs} class="form-input min-h-20" bind:value={kopf.notiz}></textarea>
            {/snippet}
          </FormField>
        </div>
      </div>
      <div data-feld="anleitung">
        <FormField
          id="gericht-{gericht.id}-anleitung"
          label="Anleitung"
          labelAs="span"
          optional
          error={felder.anleitung}
        >
          {#snippet children(attrs)}
            {#if editorGeladen}
              <LazyTextEditor
                id={attrs.id}
                labelledBy="{attrs.id}-label"
                describedBy={attrs['aria-describedby']}
                invalid={attrs['aria-invalid'] === 'true'}
                placeholder="z. B. Zwiebeln anbraten, dann …"
                maxLength={20_000}
                bind:value={kopf.anleitung}
              />
            {/if}
          {/snippet}
        </FormField>
      </div>
    </div>
    <GerichtKopfHinweise
      {konflikte}
      {ungespeichert}
      busy={kontext.busy}
      onspeichern={(feld, bewusst) => void speichern(feld, bewusst)}
      onverwerfen={verwerfen}
    />
  </form>
{/if}
