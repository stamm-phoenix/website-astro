<script lang="ts">
  import { untrack } from 'svelte';
  import { errorMessage } from '../../lib/api';
  import { esserJeMahlzeit } from '../../../../api/lib/essen-teilnehmende-model';
  import type { EssenKatalog } from '../../lib/types';
  import GruppeDialog from './GruppeDialog.svelte';
  import GruppenListe from './GruppenListe.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import QuerScroll from '../ui/QuerScroll.svelte';
  import EsserKalender from './EsserKalender.svelte';
  import TeilnehmendeDialog from './TeilnehmendeDialog.svelte';
  import TeilnehmendeListe from './TeilnehmendeListe.svelte';
  import type { PlanKontext } from './planKontext';

  /** Groups and participants of a Planung and who eats at which meal. */

  interface Props {
    kontext: PlanKontext;
    /** Whether the area is shown; the central lists load only then. */
    sichtbar: boolean;
  }
  let { kontext, sichtbar }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  /** The central lists, for the names of the intolerances. */
  let katalog = $state<EssenKatalog | null>(null);
  let katalogFehler = $state<string | null>(null);
  /** The `katalogStand` the lists were loaded for. */
  let geladen: string | null = null;
  async function katalogLaden(): Promise<void> {
    katalogFehler = null;
    geladen = ansicht.katalogStand;
    try {
      katalog = await kontext.api.katalog();
    } catch (error: unknown) {
      // Not loaded: the next view or the button tries again
      geladen = null;
      katalogFehler = errorMessage(error, 'Die Liste der Unverträglichkeiten fehlt.');
    }
  }
  $effect(() => {
    if (sichtbar && ansicht.katalogStand !== geladen) untrack(() => void katalogLaden());
  });
  const unvertraeglichkeit = $derived(
    new Map((katalog?.unvertraeglichkeiten ?? []).map((u) => [u.id, u.name]))
  );

  /** The eaters and the participants as PDF; the names of the intolerances first. */
  async function esserPdf(): Promise<void> {
    const liste = katalog ?? (await kontext.api.katalog());
    const namen = new Map(liste.unvertraeglichkeiten.map((u) => [u.id, u.name]));
    const { downloadEsserPdf } = await import('../../lib/essensplanungPdf');
    await downloadEsserPdf(ansicht, namen);
  }

  const esser = $derived(esserJeMahlzeit(ansicht));
  const gruppenName = $derived(new Map(ansicht.gruppen.map((g) => [g.id, g.name])));

  let gruppeDialog = $state<number | null | undefined>(undefined);
  let zeileDialog = $state<number | null | undefined>(undefined);
</script>

<div class="space-y-4">
  <TeilnehmendeListe
    {kontext}
    {unvertraeglichkeit}
    {katalogFehler}
    onkatalog={() => void katalogLaden()}
    onbearbeiten={(id) => (zeileDialog = id)}
  />

  <section aria-labelledby="esser-heading" class="surface space-y-2 p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="esser-heading" class="font-serif text-lg font-bold text-brand-900">
        Esser je Mahlzeit
      </h3>
      <PdfKnopf {kontext} label="Esser je Mahlzeit als PDF" erstellen={esserPdf} />
    </div>
    <QuerScroll
      label="Kalender der Esser"
      hinweis="Weitere Tage siehst du, wenn du seitlich wischst oder scrollst."
    >
      <EsserKalender {ansicht} {esser} {gruppenName} />
    </QuerScroll>
  </section>

  <GruppenListe {kontext} onbearbeiten={(id) => (gruppeDialog = id)} />
</div>

<GruppeDialog {kontext} gruppeId={gruppeDialog} onclose={() => (gruppeDialog = undefined)} />
<TeilnehmendeDialog
  {kontext}
  {katalog}
  {katalogFehler}
  onkatalog={() => void katalogLaden()}
  zeileId={zeileDialog}
  onclose={() => (zeileDialog = undefined)}
/>
