<script lang="ts">
  import FormField from './pflege/FormField.svelte';
  let {
    suggestedTitle,
    createSuggestedProject = $bindable(),
    proposedProjectTitle = $bindable(),
    fields,
  }: {
    suggestedTitle: string;
    createSuggestedProject: boolean;
    proposedProjectTitle: string;
    fields: Record<string, string>;
  } = $props();
</script>

{#if suggestedTitle}
  <fieldset class="surface-muted rounded-sm p-3 space-y-3">
    <legend class="font-semibold">Projektvorschlag</legend>
    <p class="text-sm text-neutral-700">
      Vorgeschlagen: {suggestedTitle}. Das Projekt wird erst beim Annehmen dieser Aufgabe angelegt.
      Ein inzwischen vorhandenes Projekt mit gleichem Namen wird verwendet.
    </p>
    <label class="flex min-h-11 cursor-pointer items-center gap-2">
      <input type="checkbox" class="size-5" bind:checked={createSuggestedProject} />
      Neues Projekt anlegen und Aufgabe zuordnen
    </label>
    {#if createSuggestedProject}
      <FormField
        id="suggested-project-title"
        label="Name des neuen Projekts"
        error={fields.newProjectTitle}
      >
        {#snippet children(attrs)}<input
            {...attrs}
            class="form-input"
            bind:value={proposedProjectTitle}
            maxlength="200"
            required
          />{/snippet}
      </FormField>
    {/if}
  </fieldset>
{/if}
