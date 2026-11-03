<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { planungUrl } from '../../lib/essensplanung';

  /**
   * Creates a Planung from the Leitendenbereich with name and days only; the login stands for
   * name and address (`api/lib/essen-leitung-anlegen.ts`). The new Planung opens right away.
   */

  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  let planungName = $state('');
  let ersterTag = $state('');
  let letzterTag = $state('');
  let fehler = $state<Record<string, string>>({});
  let fehlerText = $state<string | null>(null);
  let busy = $state(false);

  const dirty = $derived(!!(planungName.trim() || ersterTag || letzterTag));

  async function anlegen(): Promise<void> {
    if (busy) return;
    busy = true;
    fehler = {};
    fehlerText = null;
    try {
      const { token } = await sendApi<{ token: string }>('POST', '/intern/essensplanung/meine', {
        planungName,
        ersterTag,
        // A one-day Aktion needs no last day
        letzterTag: letzterTag || ersterTag,
      });
      window.location.assign(planungUrl(token));
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) {
        // Without a last day the first one counts, and only that field reports
        const { letzterTag: fehlerLetzter, ...rest } = error.fields;
        fehler = letzterTag && fehlerLetzter ? error.fields : rest;
      }
      fehlerText = errorMessage(
        error,
        'Die Planung konnte nicht angelegt werden. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
      busy = false;
    }
  }

  function schliessen(): void {
    planungName = '';
    ersterTag = '';
    letzterTag = '';
    fehler = {};
    fehlerText = null;
    onclose();
  }
</script>

<EditDialog
  {open}
  title="Neue Planung"
  {busy}
  {dirty}
  error={fehlerText}
  submitLabel="Planung anlegen"
  busyLabel="Wird angelegt …"
  onsubmit={() => void anlegen()}
  onclose={schliessen}
>
  <FormField id="neue-planung-name" label="Name der Planung" error={fehler.planungName}>
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        maxlength="150"
        placeholder="z. B. Sommerlager 2027"
        bind:value={planungName}
      />
    {/snippet}
  </FormField>
  <div class="grid gap-4 sm:grid-cols-2">
    <FormField id="neue-planung-erster-tag" label="Erster Tag" error={fehler.ersterTag}>
      {#snippet children(attrs)}
        <input {...attrs} type="date" class="form-input" bind:value={ersterTag} />
      {/snippet}
    </FormField>
    <FormField id="neue-planung-letzter-tag" label="Letzter Tag" optional error={fehler.letzterTag}>
      {#snippet children(attrs)}
        <input {...attrs} type="date" class="form-input" min={ersterTag} bind:value={letzterTag} />
      {/snippet}
    </FormField>
  </div>
</EditDialog>
