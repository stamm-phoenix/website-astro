<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import type { StaffEssenSteuerung } from '../../lib/types';

  interface Eintrag {
    id: number;
    etag: string;
    name: string;
    zutaten: number;
    /** Set for the 14 EU allergens, which cannot be deleted. */
    schluessel?: string | null;
  }

  interface Props {
    onnotice: (message: string | null, kind?: 'success' | 'error') => void;
    liste: 'kategorien' | 'unvertraeglichkeiten';
    title: string;
    intro: string;
    items: Eintrag[];
  }
  let { onnotice, liste, title, intro, items }: Props = $props();
  const store = essensplanungSteuerung.state;
  const singular = $derived(liste === 'kategorien' ? 'Kategorie' : 'Unverträglichkeit');

  let form = $state<{ id: number | null; etag: string; name: string; fest: boolean } | null>(null);
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && error.fields?.etag) || dialogMessage(error, fallback)
  );
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);

  function open(item?: Eintrag): void {
    form = item
      ? {
          id: item.id,
          etag: item.etag,
          name: item.name,
          fest: !!item.schluessel || (liste === 'kategorien' && item.zutaten > 0),
        }
      : { id: null, etag: '', name: '', fest: false };
    dialog.reset();
  }

  function close(): void {
    if (!busy) form = null;
  }

  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    await essensplanungSteuerung.load({ force: true });
    // Keep the input when reloading failed; the dialog still offers to try again.
    if (store.error) {
      onnotice(store.error, 'error');
      return false;
    }
    const fresh = (store.data?.[liste] as Eintrag[] | undefined)?.find((item) => item.id === id);
    if (!fresh) {
      form = null;
      return false;
    }
    open(fresh);
    return true;
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    if (dialog.invalid(form.name.trim() ? {} : { name: 'Bitte einen Namen eintragen.' })) {
      await tick();
      document.getElementById(`${liste}-name`)?.focus();
      return;
    }
    const { id, etag, name } = form;
    // A new message even when it repeats the last one, so the popup shows again
    onnotice(null);
    await dialog.run(async () => {
      if (id) {
        store.data = await sendApi<StaffEssenSteuerung>(
          'PATCH',
          `/intern/pflege/essensplanung/${liste}/${id}`,
          { name, etag }
        );
      } else {
        const result = await sendApi<{ id: number; view: StaffEssenSteuerung }>(
          'POST',
          `/intern/pflege/essensplanung/${liste}`,
          { name }
        );
        store.data = result.view;
      }
      onnotice(`${singular} „${name.trim()}“ gespeichert.`);
      form = null;
    }, `Die ${singular} wurde nicht gespeichert. Tippe noch einmal auf „Speichern“.`);
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current?.id || busy) return;
    // A new message even when it repeats the last one, so the popup shows again
    onnotice(null);
    await dialog.run(async () => {
      store.data = await sendApi<StaffEssenSteuerung>(
        'DELETE',
        `/intern/pflege/essensplanung/${liste}/${current.id}`,
        undefined,
        { etag: current.etag }
      );
      onnotice(`${singular} „${current.name}“ gelöscht.`);
      form = null;
    }, `Die ${singular} wurde nicht gelöscht.`);
  }
</script>

<section aria-labelledby="{liste}-heading" class="space-y-3">
  <div class="flex items-center gap-1">
    <h2 id="{liste}-heading" class="font-serif text-xl font-bold text-brand-900">{title}</h2>
    <InfoHint label={title} text={intro} />
  </div>
  <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
    {#each items as item (item.id)}
      <li class="flex items-center justify-between gap-3 py-2">
        <span class="min-w-0 [overflow-wrap:anywhere]">
          <span class="font-semibold text-brand-900">{item.name}</span>
          <span class="block text-sm text-neutral-700">
            {item.zutaten === 1 ? '1 Zutat' : `${item.zutaten} Zutaten`}
          </span>
        </span>
        <ActionButton
          type="button"
          class="shrink-0 print:hidden"
          aria-label="Bearbeiten: {item.name}"
          disabled={busy}
          onclick={() => open(item)}>Bearbeiten</ActionButton
        >
      </li>
    {/each}
  </ul>
  <ActionButton type="button" class="print:hidden" disabled={busy} onclick={() => open()}>
    {singular} hinzufügen
  </ActionButton>
</section>

<EditDialog
  open={form !== null}
  title={form?.id ? `${singular} bearbeiten` : `Neue ${singular}`}
  rescueKey={form ? `essen-${liste}:${form.id ?? 'neu'}` : undefined}
  rescueVersion={form?.etag}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={close}
  ondelete={form?.id && !form.fest ? remove : undefined}
  deleteTitle={`${singular} „${form?.name.trim() ?? ''}“ löschen?`}
  deleteQuestion={`Die ${singular} endgültig löschen?`}
>
  {#if form}
    <FormField id="{liste}-name" label="Name" error={errors.name}>
      {#snippet children(attrs)}
        <input {...attrs} class="form-input" maxlength="100" bind:value={form!.name} />
      {/snippet}
    </FormField>
    {#if form.id && form.fest}
      <p class="mt-3 text-sm text-neutral-700">
        {liste === 'kategorien'
          ? 'Löschen geht erst, wenn keine Zutat mehr zu dieser Kategorie gehört.'
          : 'Die Hauptallergene der EU lassen sich nicht löschen.'}
      </p>
    {/if}
  {/if}
</EditDialog>
