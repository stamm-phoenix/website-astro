<script lang="ts">
  import { ApiError, sendApi, errorMessage } from '../../lib/api';
  import type { BlogWorkflow } from '../../../../api/lib/blog-workflow-model';
  import ActionButton from '../ui/ActionButton.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { blogPflege } from '../../lib/pflegeStore.svelte';
  interface Props {
    id: string;
    etag: string;
    disabled: boolean;
    workflow: BlogWorkflow;
    busy?: boolean;
    feedback?: string;
    onchanged: (result: { etag: string; workflow: BlogWorkflow }, message: string) => void;
  }
  let {
    id,
    etag,
    disabled,
    workflow,
    busy = $bindable(false),
    feedback = $bindable(''),
    onchanged,
  }: Props = $props();
  let error = $state('');
  const labels = {
    draft: 'Entwurf',
    review: 'Zur Prüfung',
    approved: 'Freigegeben',
    published: 'Veröffentlicht',
  };
  async function act(action: string): Promise<void> {
    if (disabled || busy) return;
    busy = true;
    error = '';
    try {
      const result = await sendApi<{ etag: string; workflow: BlogWorkflow }>(
        'PATCH',
        `/intern/pflege/blog/${id}`,
        { action, etag, feedback }
      );

      feedback = '';
      blogPflege.invalidate();
      onchanged(
        result,
        (
          {
            submit: 'Beitrag zur Prüfung eingereicht.',
            approve: 'Beitrag freigegeben.',
            return: 'Beitrag mit Rückmeldung zurückgegeben.',
            publish: 'Beitrag veröffentlicht.',
            unpublish: 'Veröffentlichung zurückgenommen.',
          } as Record<string, string>
        )[action]
      );
    } catch (cause: unknown) {
      error =
        (cause instanceof ApiError &&
          (cause.fields?.action || cause.fields?.feedback || cause.fields?.etag)) ||
        errorMessage(
          cause,
          'Der Stand wurde nicht geändert. Deine Rückmeldung ist noch da. Prüfe deine Verbindung und versuche es noch einmal.'
        );
    } finally {
      busy = false;
    }
  }
</script>

<section
  aria-label="Prüfung und Veröffentlichung"
  class="w-full space-y-3 border-t border-neutral-200 pt-4"
>
  {#if workflow}
    <StatusLabel
      label={labels[workflow.state]}
      tone={workflow.state === 'published' || workflow.state === 'approved' ? 'success' : 'neutral'}
    />
    <dl class="space-y-1 text-sm text-neutral-700">
      {#each [['Eingereicht', workflow.submitted], ['Geprüft', workflow.reviewed], ['Veröffentlicht', workflow.publication]] as [label, event] (label)}
        {#if event && typeof event !== 'string'}
          <div>
            <dt class="inline font-semibold">{label}:</dt>
            <dd class="inline">{event.name} · {new Date(event.at).toLocaleString('de-DE')}</dd>
          </div>
        {/if}
      {/each}
    </dl>
    {#if workflow.feedback}<p class="text-sm text-neutral-700">
        Rückmeldung: {workflow.feedback}
      </p>{/if}
    {#if workflow.state === 'review'}
      <label class="block text-sm"
        ><span class="form-label">Rückmeldung bei Rückgabe</span><textarea
          class="form-input"
          disabled={disabled || busy}
          maxlength="2000"
          bind:value={feedback}></textarea></label
      >
    {/if}
    <div class="flex flex-wrap gap-2">
      {#if workflow.state === 'draft'}
        <ActionButton type="button" disabled={disabled || busy} onclick={() => act('submit')}
          >Zur Prüfung einreichen</ActionButton
        >
      {:else if workflow.state === 'review'}
        <ActionButton type="button" disabled={disabled || busy} onclick={() => act('approve')}
          >Freigeben</ActionButton
        >
        <ActionButton
          type="button"
          disabled={disabled || busy || !feedback.trim()}
          onclick={() => act('return')}>Mit Rückmeldung zurückgeben</ActionButton
        >
      {:else if workflow.state === 'approved'}
        <ActionButton type="button" disabled={disabled || busy} onclick={() => act('publish')}
          >Veröffentlichen</ActionButton
        >
      {:else}
        <ActionButton type="button" disabled={disabled || busy} onclick={() => act('unpublish')}
          >Veröffentlichung zurücknehmen</ActionButton
        >
      {/if}
    </div>
  {/if}
  {#if disabled}<p class="text-sm text-neutral-700">Änderungen zuerst speichern.</p>{/if}
  {#if busy}<p role="status">Wird geändert …</p>{/if}
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
</section>
