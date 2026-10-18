<script lang="ts">
  import FormField from './pflege/FormField.svelte';
  import { aufgabenStore } from '../lib/aufgabenStore.svelte';
  import { taskProjects } from '../lib/aufgabenView';
  let {
    id = 'task-project',
    value = $bindable(''),
    required = false,
    disabled = false,
    error,
  }: {
    id?: string;
    value?: string;
    required?: boolean;
    disabled?: boolean;
    error?: string;
  } = $props();
  const projects = $derived(taskProjects(aufgabenStore.data?.tasks ?? []));
</script>

<FormField
  {id}
  label="Projekt"
  optional={!required}
  {error}
  hint="Wähle ein Projekt oder tippe einen neuen Namen. Ein Projekt gibt es, solange eine Aufgabe darin steht."
  >{#snippet children(attrs)}<input
      {...attrs}
      class="form-input"
      list="{id}-list"
      autocomplete="off"
      bind:value
      maxlength="200"
      placeholder={required ? undefined : 'Ohne Projekt'}
      {required}
      {disabled}
    /><datalist id="{id}-list"
      >{#each projects as project (project.title)}<option value={project.title}
        ></option>{/each}</datalist
    >{/snippet}</FormField
>
