<script lang="ts">
  import type { NikolausAuditEntry } from '../../lib/types';
  import { dateTime } from '../../lib/nikolausSteuerungForm';
  interface Props {
    entries: NikolausAuditEntry[];
  }
  let { entries }: Props = $props();
  const FIELD_LABELS: Record<string, string> = {
    publicActive: 'Online-Anmeldung',
    staffActive: 'Nikolausverwaltung',
    maintenance: 'Wartungsmodus',
    pendingHoldMinutes: 'Reservierungsdauer',
    changeDeadlineHours: 'Änderungsfrist',
    days: 'Besuchstage',
    area: 'Einsatzgebiet',
  };

  const SWITCH_FIELDS = new Set(['publicActive', 'staffActive', 'maintenance']);

  function describe(entry: NikolausAuditEntry): string {
    if (entry.action === 'settings') {
      const changes = (entry.details.changes ?? {}) as Record<string, { to: unknown }>;
      return Object.entries(changes)
        .map(([field, change]) =>
          SWITCH_FIELDS.has(field)
            ? `${FIELD_LABELS[field]} ${change.to ? 'an' : 'aus'}`
            : `${FIELD_LABELS[field] ?? field} geändert`
        )
        .join(', ');
    }
    const deleted = (entry.details.deleted ?? {}) as Record<string, number>;
    if (entry.action === 'delete-bookings') return `${deleted.bookings ?? 0} Anmeldungen gelöscht`;
    if (entry.action === 'delete-helpers') return `${deleted.helpers ?? 0} Helfende gelöscht`;
    if (entry.action === 'geocoding-release') return 'Sperre der Adresssuche gelöst';
    return entry.action;
  }
</script>

<section aria-labelledby="log-heading">
  <h2 id="log-heading" class="font-serif text-xl font-bold text-brand-900">Protokoll</h2>
  {#if entries.length}
    <ul class="mt-3 divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
      {#each entries as entry (entry.id)}
        <li class="flex flex-wrap gap-x-4 gap-y-1 py-2">
          <span class="tabular-nums text-neutral-700">{dateTime.format(new Date(entry.at))}</span>
          <span class="text-neutral-700">{entry.actor}</span>
          <span class="text-neutral-900">{describe(entry)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 text-sm text-neutral-700">Noch keine Änderungen.</p>
  {/if}
</section>
