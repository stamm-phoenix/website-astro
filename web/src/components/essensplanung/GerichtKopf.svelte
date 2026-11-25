<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import TagInput from '../pflege/TagInput.svelte';
  import LazyTextEditor from '../ui/LazyTextEditor.svelte';
  import { ApiError } from '../../lib/api';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { nachDemTippen } from '../../lib/nachDemTippen';
  import type { Gericht } from '../../../../api/lib/essen-gerichte-model';
  import { FELD_NAMEN, KOPF_FELDER, gleich, kopfVon, textVon, type KopfFeld } from './gerichtKopf';
  import { meldeVerloren, merkeSpeichern, type PlanKontext } from './planKontext';

  /**
   * The fields of a dish for those who edit. Each field saves on its own as soon as it is left
   * (a tool or a removed link at once), so the others see it right away. A field keeps the
   * version it was typed on: when someone else saved the same field meanwhile, it warns and
   * saves only on „Trotzdem speichern“; changes of others to other fields come in as they are.
   */

  interface Props {
    kontext: PlanKontext;
    gericht: Gericht;
    /** True once the card was shown, so the editor of the instructions loads. */
    editorGeladen: boolean;
    /** Whether the page deletes the dish itself, which needs no word about lost input. */
    selbstGeloescht: () => boolean;
  }
  let { kontext, gericht, editorGeladen, selbstGeloescht }: Props = $props();

  /** The saved fields each field started from, and the input. */
  let basis = $state(kopfVon(untrack(() => gericht)));
  let kopf = $state(kopfVon(untrack(() => gericht)));
  let felder = $state<Record<string, string>>({});
  /** Fields someone else saved under the typed input; they save only when asked to. */
  let konflikte = $state<KopfFeld[]>([]);
  /** A tool name typed but not yet added. */
  let werkzeugEntwurf = $state('');
  /** The field that has the focus; a change of others does not replace it under the cursor. */
  let fokusFeld = $state<KopfFeld | null>(null);

  const geaendert = (feld: KopfFeld): boolean => !gleich(kopf[feld], basis[feld]);
  /** Whether a field holds input; a function too, as a derived read when the card goes may be stale. */
  const offen = (): boolean => KOPF_FELDER.some(geaendert) || werkzeugEntwurf.trim() !== '';
  $effect(() => guardUnsavedChanges(offen));

  // Fields without input follow the saved state, also those of others
  $effect(() => {
    const neu = kopfVon(gericht);
    untrack(() => {
      for (const feld of KOPF_FELDER) {
        if (geaendert(feld) || fokusFeld === feld) continue;
        basis = { ...basis, [feld]: neu[feld] };
        kopf = { ...kopf, [feld]: neu[feld] };
      }
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

  async function speichernJetzt(feld: KopfFeld, bewusst: boolean): Promise<boolean> {
    if (konflikte.includes(feld) && !bewusst) return false;
    konflikte = konflikte.filter((f) => f !== feld);
    if (!geaendert(feld)) {
      fehlerWeg(feld);
      // A change of others that came in while the field had the focus shows now
      const aktuell = kopfVon(gericht)[feld];
      basis = { ...basis, [feld]: aktuell };
      kopf = { ...kopf, [feld]: aktuell };
      return true;
    }
    // Someone else saved this field meanwhile: keep the input and let the person decide
    const geprueft = basis[feld];
    if (!bewusst && !gleich(kopfVon(gericht)[feld], geprueft)) {
      basis = { ...basis, [feld]: kopfVon(gericht)[feld] };
      konflikte = [...konflikte, feld];
      return false;
    }
    // The version checked against; a change of others while this waits makes the server refuse it
    const geprueftEtag = gericht.etag;
    const gesendet = $state.snapshot(kopf[feld]);
    // Empty links are left out; the form index of each sent one, for the errors coming back
    const linkIndex = kopf.links.flatMap((link, index) =>
      link.url.trim() || link.titel.trim() ? [index] : []
    );
    const wert =
      feld === 'personen'
        ? kopf.personen.trim() === ''
          ? null
          : Number.isInteger(Number(kopf.personen))
            ? Number(kopf.personen)
            : kopf.personen
        : feld === 'links'
          ? linkIndex.map((index) => kopf.links[index])
          : gesendet;
    const name = feld === 'name' && kopf.name.trim() ? kopf.name.trim() : gericht.name;
    const ok = await kontext.aendern(async () => {
      // In the queue, the newest version counts as long as this field is still as checked
      const etag =
        bewusst || gleich(kopfVon(gericht)[feld], geprueft) ? gericht.etag : geprueftEtag;
      try {
        return await kontext.api.senden('PATCH', `/gerichte/${gericht.id}`, {
          etag,
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
    const aktuell = kopfVon(gericht)[feld];
    if (ok) {
      fehlerWeg(feld);
      basis = { ...basis, [feld]: aktuell };
      // Typed on while it saved: that input stays as a draft
      if (gleich(kopf[feld], gesendet)) kopf = { ...kopf, [feld]: aktuell };
    } else if (!gleich(aktuell, geprueft)) {
      basis = { ...basis, [feld]: aktuell };
      konflikte = [...konflikte, feld];
    }
    return ok;
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
    const aktuell = kopfVon(gericht)[feld];
    basis = { ...basis, [feld]: aktuell };
    kopf = { ...kopf, [feld]: aktuell };
    konflikte = konflikte.filter((f) => f !== feld);
    fehlerWeg(feld);
  }

  // Someone else deleted the dish: the card goes, so the unsaved fields are shown to copy
  $effect(() => () => {
    if (selbstGeloescht() || !offen()) return;
    const eingaben = KOPF_FELDER.filter(geaendert)
      .map((feld) => `${FELD_NAMEN[feld]}: ${textVon(kopf[feld])}`)
      .concat(werkzeugEntwurf.trim() ? [`${FELD_NAMEN.werkzeuge}: ${werkzeugEntwurf.trim()}`] : [])
      .join(' · ');
    meldeVerloren(
      kontext,
      `„${gericht.name}“ wurde gerade gelöscht. Deine ungespeicherten Eingaben: ${eingaben}`
    );
  });
</script>

<form
  class="space-y-3 print:hidden"
  onsubmit={(event) => event.preventDefault()}
  onfocusin={(event) => (fokusFeld = feldVon(event.target))}
  onfocusout={verlassen}
>
  <p class="text-sm text-neutral-700">Wird sofort gespeichert.</p>
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
      <fieldset class="space-y-2" data-feld="links">
        <legend class="form-label">Links</legend>
        {#each kopf.links as link, index (index)}
          <div class="flex flex-wrap items-end gap-2">
            <FormField
              id="gericht-{gericht.id}-link-{index}-titel"
              label="Titel"
              optional
              class="min-w-0 flex-1"
              error={felder[`links.${index}.titel`]}
            >
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  class="form-input"
                  maxlength="100"
                  bind:value={link.titel}
                  onkeydown={taste}
                />
              {/snippet}
            </FormField>
            <FormField
              id="gericht-{gericht.id}-link-{index}-url"
              label="Adresse"
              class="min-w-0 flex-[2]"
              error={felder[`links.${index}.url`]}
            >
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  class="form-input"
                  type="url"
                  placeholder="https://"
                  bind:value={link.url}
                  onkeydown={taste}
                />
              {/snippet}
            </FormField>
            <ActionButton
              type="button"
              aria-label="Link {index + 1} entfernen"
              onclick={() => {
                kopf.links.splice(index, 1);
                fehlerWeg('links');
                speichernSpaeter('links');
              }}
            >
              Entfernen
            </ActionButton>
          </div>
        {/each}
        <ActionButton
          type="button"
          disabled={kopf.links.length >= 10}
          onclick={() => kopf.links.push({ titel: '', url: '' })}
        >
          Link hinzufügen
        </ActionButton>
      </fieldset>
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
  {#each konflikte as feld (feld)}
    <div class="space-y-2 border-l-4 border-warning py-1 pl-3" role="alert">
      <p class="text-sm text-warning">
        Jemand anderes hat {FELD_NAMEN[feld]} gerade geändert. Deine Eingabe steht noch im Feld.
      </p>
      <div class="flex flex-wrap gap-2">
        <ActionButton
          type="button"
          variant="primary"
          disabled={kontext.busy}
          onclick={() => void speichern(feld, true)}
        >
          Trotzdem speichern
        </ActionButton>
        <ActionButton type="button" onclick={() => verwerfen(feld)}>
          Neuen Stand nehmen
        </ActionButton>
      </div>
    </div>
  {/each}
</form>
