<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { datumLang, vergiss } from '../../lib/essensplanung';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { PlanKontext } from './planKontext';

  /** Name, who manages members, and deleting the Planung (owners); the retention for all. */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const besitzer = $derived(ansicht.zugang === 'besitzer' && !ansicht.wartung);

  /** The saved state the input started from; changes of others replace it only without a draft. */
  let basis = $state({ name: '', mitgliederVerwalten: false });
  let name = $state('');
  let mitgliederVerwalten = $state(false);
  const entwurf = $derived(
    name !== basis.name || mitgliederVerwalten !== basis.mitgliederVerwalten
  );
  $effect(() => {
    const neu = { name: ansicht.name, mitgliederVerwalten: ansicht.mitgliederVerwalten };
    untrack(() => {
      if (entwurf) return;
      basis = neu;
      name = neu.name;
      mitgliederVerwalten = neu.mitgliederVerwalten;
    });
  });
  $effect(() => guardUnsavedChanges(() => entwurf));

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    // Only the changed fields, with what the form started from: a field someone else changed
    // meanwhile is a conflict, the other one keeps what they saved
    const neuerName = name.trim();
    const body = {
      ...(neuerName !== basis.name ? { name: neuerName } : {}),
      ...(mitgliederVerwalten !== basis.mitgliederVerwalten ? { mitgliederVerwalten } : {}),
      vorher: basis,
    };
    const gesendet = { name, mitgliederVerwalten };
    const ok = await kontext.aendern(
      () => kontext.api.senden('PATCH', '', body),
      'Einstellungen gespeichert.'
    );
    const aktuell = { name: ansicht.name, mitgliederVerwalten: ansicht.mitgliederVerwalten };
    // A field typed in again while saving keeps the new input as a draft
    const nameDanach = name !== gesendet.name;
    const schalterDanach = mitgliederVerwalten !== gesendet.mitgliederVerwalten;
    if (ok) {
      basis = aktuell;
      if (!nameDanach) name = aktuell.name;
      if (!schalterDanach) mitgliederVerwalten = aktuell.mitgliederVerwalten;
      return;
    }
    // After a conflict the next try starts from what is saved now; a field the person did not
    // touch shows it, the changed one keeps the input
    if (!('name' in body) && !nameDanach) name = aktuell.name;
    if (!('mitgliederVerwalten' in body) && !schalterDanach)
      mitgliederVerwalten = aktuell.mitgliederVerwalten;
    basis = aktuell;
  }

  async function loeschen(): Promise<void> {
    if (
      !(await confirmAction({
        title: `„${ansicht.name}“ löschen?`,
        message:
          'Die Planung wird mit allen Tagen, Mahlzeiten und Mitgliedern endgültig gelöscht. Alle Links funktionieren danach nicht mehr.',
        confirmLabel: 'Endgültig löschen',
      }))
    )
      return;
    const ok = await kontext.aendern(async () => {
      await kontext.api.senden('DELETE', '');
      return undefined;
    });
    if (ok) {
      vergiss(kontext.token);
      window.location.replace('/essensplanung');
    }
  }
</script>

<div class="space-y-8">
  {#if ansicht.loeschtAm}
    <p class="text-sm text-neutral-700">
      Die Planung wird am {datumLang(ansicht.loeschtAm)} mit allen Daten gelöscht. Die Besitzer:innen
      bekommen zwei Wochen vorher eine Mail.
    </p>
  {/if}

  {#if besitzer}
    <form class="surface max-w-xl space-y-4 p-5" onsubmit={speichern}>
      <div>
        <label class="form-label" for="planung-name">Name der Planung</label>
        <input id="planung-name" class="form-input" maxlength="150" bind:value={name} />
      </div>
      <div class="flex items-center gap-1">
        <label class="flex min-h-11 items-center gap-3">
          <input type="checkbox" bind:checked={mitgliederVerwalten} />
          <span class="font-semibold text-brand-900">
            Alle dürfen Mitglieder verwalten: {mitgliederVerwalten ? 'an' : 'aus'}
          </span>
        </label>
        <InfoHint
          label="Mitglieder verwalten"
          text="Auch Bearbeitende laden ein, entziehen Zugänge und erzeugen die gemeinsamen Links. Besitzer:innen ernennen und löschen dürfen weiter nur Besitzer:innen."
        />
      </div>
      <ActionButton variant="primary" type="submit" disabled={kontext.busy || !entwurf}
        >Speichern</ActionButton
      >
    </form>

    <section aria-labelledby="loeschen-heading" class="max-w-xl space-y-2">
      <h3 id="loeschen-heading" class="font-serif text-xl font-bold text-brand-900">
        Planung löschen
      </h3>
      <ActionButton
        type="button"
        variant="danger"
        disabled={kontext.busy}
        onclick={() => void loeschen()}>Planung löschen</ActionButton
      >
    </section>
  {:else if ansicht.zugang === 'bearbeiten'}
    <p class="text-sm text-neutral-700">Name und Löschen der Planung ändern die Besitzer:innen.</p>
  {/if}
</div>
