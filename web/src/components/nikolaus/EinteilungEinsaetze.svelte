<script lang="ts">
  import { HELPER_ROLES } from '../../lib/nikolausEinteilung';
  import type { EinteilungPerson, HelperRole } from '../../lib/nikolausEinteilung';
  import type { Einsaetze } from '../../lib/nikolausEinteilungKacheln';

  interface Props {
    persons: EinteilungPerson[];
    /** Posts per person over all days, the kitchen included. */
    einsaetze: Map<string, Einsaetze>;
  }

  let { persons, einsaetze }: Props = $props();

  /** Who volunteered for anything, most posts first. */
  const rows = $derived(
    persons
      .filter((p) => Object.values(p.availability).some((roles) => roles.length > 0))
      .map((person) => ({
        person,
        total: einsaetze.get(person.id)?.total ?? 0,
        volunteered: new Set(Object.values(person.availability).flat()),
      }))
      .sort((a, b) => b.total - a.total || a.person.name.localeCompare(b.person.name, 'de'))
  );

  /** Short column heads for phones; the full name stays in the title. */
  const SHORT: Record<HelperRole | 'Gesamt', string> = {
    Gesamt: 'Ges.',
    Nikolaus: 'Nik.',
    Krampus: 'Kra.',
    'Fahrer*in': 'Fah.',
    Engerl: 'Eng.',
    Küche: 'Kü.',
  };

  function count(personId: string, role: HelperRole): number {
    return einsaetze.get(personId)?.byRole[role] ?? 0;
  }
</script>

{#if rows.length > 0}
  <section aria-labelledby="einsaetze-heading" class="border-t border-neutral-200 pt-6">
    <h2 id="einsaetze-heading" class="font-serif text-xl font-semibold text-brand-900">
      Einsätze pro Person
    </h2>
    <div class="mt-3 overflow-x-auto">
      <table class="w-full text-sm tabular-nums">
        <thead>
          <tr class="border-b border-neutral-300 text-left text-xs text-neutral-700">
            <th scope="col" class="py-2 pr-3 font-semibold">Person</th>
            {#each ['Gesamt' as const, ...HELPER_ROLES] as head (head)}
              <th scope="col" class="px-1.5 py-2 text-right font-semibold sm:px-2">
                <abbr class="no-underline sm:hidden" title={head}>{SHORT[head]}</abbr>
                <span class="hidden sm:inline">{head}</span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-200">
          {#each rows as row (row.person.id)}
            <tr>
              <th scope="row" class="py-1.5 pr-3 text-left font-normal text-brand-900">
                {row.person.name}
              </th>
              <td class="px-1.5 py-1.5 text-right font-semibold sm:px-2">{row.total}</td>
              {#each HELPER_ROLES as role (role)}
                <td class="px-1.5 py-1.5 text-right sm:px-2">
                  {#if row.volunteered.has(role)}
                    {count(row.person.id, role)}
                  {:else}
                    <span class="text-neutral-400" aria-label="nicht gemeldet">–</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}
