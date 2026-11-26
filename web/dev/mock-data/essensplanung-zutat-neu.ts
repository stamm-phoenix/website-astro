/**
 * A typed name for a line of a dish in the mock API, like `zutatFuerNeuenNamen` of the API: the
 * food of the list or of the Planung of that name, else a new own one with open details.
 */
import type { GerichtEinheit, PlanungZutat } from '../../../api/lib/essen-gerichte-model';
import { einheitenartFuerNeue } from '../../../api/lib/essen-gerichte-model';
import { essenKatalog } from './essensplanung';
import type { MockPlanungZutat } from './essensplanung-gerichte';
import { sonstigesKategorie, wirksam, zutatFuer } from './essensplanung-gerichte';
import type { MockZugang } from './essensplanung-planung';
import { neueId, neuesEtag } from './essensplanung-planung';

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/** Like `zutatFuerNeuenNamen`: a typed name becomes a food of the Planung's own. */
export function neuerNameFuer(
  z: MockZugang,
  name: string,
  einheit: GerichtEinheit | null
): PlanungZutat {
  const zentral = essenKatalog().zutaten.find((entry) => collator.compare(entry.name, name) === 0);
  if (zentral) return zutatFuer(z, { zutatId: zentral.id }, { lebensmittel: true });
  const eigene = z.planung.zutaten.find(
    (entry) => entry.name && collator.compare(entry.name, name) === 0
  );
  if (eigene) return zutatFuer(z, { planungZutatId: eigene.id }, { lebensmittel: true });
  const eintrag: MockPlanungZutat = {
    id: neueId(),
    etag: neuesEtag(),
    zutatId: null,
    name,
    kategorieId: sonstigesKategorie(),
    einheitenart: einheitenartFuerNeue({ kategorieId: null, einheitenart: null, einheit }),
    vegetarisch: null,
    vegan: null,
    allergene: [],
    geschaeftId: null,
    angabenOffen: true,
  };
  z.planung.zutaten.push(eintrag);
  return wirksam(z.planung, eintrag);
}
