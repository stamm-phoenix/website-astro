<script lang="ts">
  import { untrack } from 'svelte';
  import type { GruppenstundenException } from '../../../../api/lib/gruppenstunden-exception-model';
  import FormField from './FormField.svelte';

  interface Props {
    exception: GruppenstundenException | null;
    resetKey: string;
    errors?: Record<string, string>;
    onchange: (exception: GruppenstundenException) => void;
  }

  let { exception, resetKey, errors = {}, onchange }: Props = $props();
  let startDate = $state('');
  let endDate = $state('');
  let message = $state('');
  let location = $state('');
  let time = $state('');

  $effect(() => {
    void resetKey;
    const current = untrack(() => exception);
    startDate = current?.startDate ?? '';
    endDate = current?.endDate ?? '';
    message = current?.message ?? '';
    location = current?.location ?? '';
    time = current?.time ?? '';
  });

  function update(): void {
    onchange({ startDate, endDate, message, location, time });
  }
</script>

<fieldset class="grid gap-4 border-t border-neutral-200 pt-4 sm:grid-cols-2">
  <legend class="form-label sm:col-span-2">Hinweiszeitraum</legend>
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
  {#if errors.exception}
    <p class="text-sm text-danger sm:col-span-2" role="alert">{errors.exception}</p>
  {/if}
</fieldset>
