<script lang="ts">
  import { formatDateTime } from '../../lib/format';
  import type { NikolausAuditEntry } from '../../lib/types';
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
    dayContact: 'Kontakt am Besuchstag',
  };

  const SWITCH_FIELDS = new Set(['publicActive', 'staffActive', 'maintenance']);

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function describe(entry: NikolausAuditEntry): string {
    if (entry.action === 'settings') {
      const changes = entry.details.changes;
      if (!isRecord(changes)) return 'Einstellungen geändert';
      return Object.entries(changes)
        .map(([field, change]) =>
          SWITCH_FIELDS.has(field) && change && typeof change === 'object' && 'to' in change
            ? `${FIELD_LABELS[field]} ${change.to ? 'an' : 'aus'}`
            : `${FIELD_LABELS[field] ?? field} geändert`
        )
        .join(', ');
    }
    const deleted = isRecord(entry.details.deleted) ? entry.details.deleted : {};
    const count = (key: string): number => {
      const value = deleted[key];
      return typeof value === 'number' ? value : 0;
    };
    if (entry.action === 'delete-bookings') return `${count('bookings')} Anmeldungen gelöscht`;
    if (entry.action === 'delete-helpers') return `${count('helpers')} Helfende gelöscht`;
    // Only in older entries: the address search no longer has a reservation to release
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
          <span class="tabular-nums text-neutral-700">{formatDateTime(entry.at)}</span>
          <span class="text-neutral-700">{entry.actor}</span>
          <span class="text-neutral-900">{describe(entry)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 text-sm text-neutral-700">Noch keine Änderungen.</p>
  {/if}
</section>
