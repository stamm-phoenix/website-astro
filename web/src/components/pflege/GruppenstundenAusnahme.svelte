<script lang="ts">
  import { untrack } from 'svelte';
  import type { GruppenstundenException } from '../../../../api/lib/gruppenstunden-exception-model';
  import FormField from './FormField.svelte';

  interface Props {
    exception: GruppenstundenException | null;
    resetKey: string;
    errors?: Record<string, string>;
    onchange: (exception: GruppenstundenException | null) => void;
  }

  let { exception, resetKey, errors = {}, onchange }: Props = $props();
  let enabled = $state(false);
  let startDate = $state('');
  let endDate = $state('');
  let message = $state('');
  let location = $state('');
  let time = $state('');

  $effect(() => {
    void resetKey;
    const current = untrack(() => exception);
    enabled = current !== null;
    startDate = current?.startDate ?? '';
    endDate = current?.endDate ?? '';
    message = current?.message ?? '';
    location = current?.location ?? '';
    time = current?.time ?? '';
  });

  function update(): void {
    onchange(enabled ? { startDate, endDate, message, location, time } : null);
  }

  function toggle(): void {
    enabled = !enabled;
    update();
  }
</script>

<fieldset class="sm:col-span-2 border-t border-neutral-200 pt-4">
  <legend class="form-label">Abweichung für einen Zeitraum</legend>
  <label class="mt-2 flex min-h-11 items-center gap-3 text-sm">
    <input type="checkbox" class="size-5" checked={enabled} onchange={toggle} />
    <span>Abweichung anzeigen</span>
  </label>

  {#if errors.exception}
    <p class="text-sm text-danger" role="alert">{errors.exception}</p>
  {/if}
  <div hidden={!enabled}>
    <fieldset disabled={!enabled} class="mt-3 grid gap-4 sm:grid-cols-2">
      <FormField id="gs-exception-start" label="Von" error={errors.exceptionStartDate}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            type="date"
            bind:value={
              () => startDate,
              (value) => {
                startDate = value;
                update();
              }
            }
          />
        {/snippet}
      </FormField>
      <FormField id="gs-exception-end" label="Bis" error={errors.exceptionEndDate}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            type="date"
            bind:value={
              () => endDate,
              (value) => {
                endDate = value;
                update();
              }
            }
          />
        {/snippet}
      </FormField>
      <FormField id="gs-exception-message" label="Hinweis" error={errors.exceptionMessage}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="500"
            bind:value={
              () => message,
              (value) => {
                message = value;
                update();
              }
            }
          />
        {/snippet}
      </FormField>
      <FormField
        id="gs-exception-location"
        label="Abweichender Ort"
        optional
        error={errors.exceptionLocation}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="120"
            bind:value={
              () => location,
              (value) => {
                location = value;
                update();
              }
            }
          />
        {/snippet}
      </FormField>
      <FormField
        id="gs-exception-time"
        label="Abweichende Uhrzeit"
        optional
        error={errors.exceptionTime}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="60"
            placeholder="18:00 – 20:00 Uhr"
            bind:value={
              () => time,
              (value) => {
                time = value;
                update();
              }
            }
          />
        {/snippet}
      </FormField>
    </fieldset>
  </div>
</fieldset>
