<script lang="ts">
  import { tick } from 'svelte';
  import AltchaWidget from './AltchaWidget.svelte';
  import FormField from './pflege/FormField.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import { ApiError, postApi } from '../lib/api';
  import {
    SCHNUPPER_ALTER,
    SCHNUPPER_MAX_LENGTH,
    validateSchnupperAnfrage,
  } from '../lib/schnupper';
  import type { SchnupperField, SchnupperSent } from '../lib/schnupper';
  import { guardUnsavedChanges } from '../lib/unsavedChanges';
  const ID = 'schnupper';
  const FIELD_ORDER: SchnupperField[] = [
    'alter',
    'kindVorname',
    'wunschzeit',
    'name',
    'email',
    'telefon',
    'nachricht',
  ];

  let alter = $state('');
  let kindVorname = $state('');
  let wunschzeit = $state('');
  let name = $state('');
  let email = $state('');
  let telefon = $state('');
  let nachricht = $state('');
  let website = $state('');

  let errors = $state<Partial<Record<SchnupperField, string>>>({});
  let formError = $state<string | null>(null);
  let sending = $state(false);
  let sentTo = $state<string | null>(null);
  let receiptSent = $state(true);
  let altchaWidget = $state<AltchaWidget | null>(null);

  const hasUnsentInput = $derived(
    !sentTo &&
      [alter, kindVorname, wunschzeit, name, email, telefon, nachricht].some(
        (value) => value.length > 0
      )
  );

  $effect(() => {
    if (hasUnsentInput) return guardUnsavedChanges(() => hasUnsentInput);
  });

  function clearError(field: SchnupperField): void {
    if (errors[field]) errors = { ...errors, [field]: undefined };
    formError = null;
  }

  async function focusFirstError(): Promise<void> {
    await tick();
    const field = FIELD_ORDER.find((key) => errors[key]);
    if (field) document.getElementById(`${ID}-${field}`)?.focus();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (sending) return;

    const validation = validateSchnupperAnfrage({
      alter,
      kindVorname,
      wunschzeit,
      name,
      email,
      telefon,
      nachricht,
    });
    errors = validation.errors;
    if (!validation.anfrage) {
      await focusFirstError();
      return;
    }

    formError = null;
    sending = true;
    try {
      const altcha = (await altchaWidget?.solve()) ?? null;
      if (!altcha) {
        formError =
          'Die Prüfung, ob du ein Mensch bist, hat nicht geklappt. Bitte setz das Häkchen und versuch es noch einmal.';
        return;
      }
      const result = await postApi<SchnupperSent>('/schnupperanfrage', {
        ...validation.anfrage,
        website,
        altcha,
      });
      receiptSent = result.receipt;
      sentTo = validation.anfrage.email;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.fields) {
        errors = err.fields as Partial<Record<SchnupperField, string>>;
        await focusFirstError();
      }
      formError =
        err instanceof ApiError && err.code
          ? err.message
          : err instanceof ApiError
            ? 'Deine Anfrage wurde nicht gesendet. Deine Eingaben sind noch da. Bitte versuch es später noch einmal oder schreib uns an kontakt@stamm-phoenix.de.'
            : // The connection broke: the request may have been saved before the answer was lost
              'Die Verbindung ist abgebrochen, deshalb wissen wir nicht, ob deine Anfrage angekommen ist. Deine Eingaben sind noch da. Schau in ein paar Minuten in dein Postfach: Kommt keine Bestätigung, schick die Anfrage noch einmal.';
    } finally {
      sending = false;
      // Each solved challenge is accepted only once.
      altchaWidget?.reset();
    }
  }
</script>

{#if sentTo}
  <div
    class="border-l-4 border-success bg-success-soft px-4 py-3 text-sm text-neutral-900"
    role="status"
  >
    <p><strong>Schnupperstunde angefragt.</strong> Deine Anfrage ist bei uns angekommen.</p>
    {#if receiptSent}
      <p class="mt-2">
        Wir haben dir eine Bestätigung an <strong>{sentTo}</strong> geschickt. Sobald der Termin feststeht,
        bekommst du eine zweite E-Mail. Keine E-Mail erhalten? Dann schau bitte im Spam-Ordner nach.
      </p>
    {:else}
      <p class="mt-2">
        Die Bestätigung an <strong>{sentTo}</strong> konnte gerade nicht verschickt werden. Du musst nichts
        weiter tun: Sobald der Termin feststeht, schreiben wir dir an diese Adresse.
      </p>
    {/if}
  </div>
{:else}
  <form class="space-y-5" novalidate onsubmit={submit} aria-describedby="{ID}-privacy">
    <!-- Locked while sending, so what is sent is what is shown -->
    <fieldset class="grid min-w-0 gap-5 md:grid-cols-2" disabled={sending}>
      <FormField id="{ID}-alter" label="Alter des Kindes" error={errors.alter}>
        {#snippet children(field)}
          <input
            {...field}
            type="number"
            inputmode="numeric"
            min={SCHNUPPER_ALTER.min}
            max={SCHNUPPER_ALTER.max}
            step="1"
            placeholder="z. B. 8"
            required
            bind:value={() => alter, (value) => (alter = value == null ? '' : String(value))}
            oninput={() => clearError('alter')}
            class="form-input"
          />
        {/snippet}
      </FormField>

      <FormField
        id="{ID}-kindVorname"
        label="Vorname des Kindes"
        optional
        error={errors.kindVorname}
      >
        {#snippet children(field)}
          <input
            {...field}
            type="text"
            autocomplete="off"
            maxlength={SCHNUPPER_MAX_LENGTH.kindVorname}
            bind:value={kindVorname}
            oninput={() => clearError('kindVorname')}
            class="form-input"
          />
        {/snippet}
      </FormField>

      <FormField id="{ID}-wunschzeit" label="Wann möchtest du kommen?" error={errors.wunschzeit}>
        {#snippet children(field)}
          <input
            {...field}
            type="text"
            maxlength={SCHNUPPER_MAX_LENGTH.wunschzeit}
            placeholder="z. B. nach den Herbstferien"
            required
            bind:value={wunschzeit}
            oninput={() => clearError('wunschzeit')}
            class="form-input"
          />
        {/snippet}
      </FormField>

      <FormField id="{ID}-name" label="Dein Name" error={errors.name}>
        {#snippet children(field)}
          <input
            {...field}
            type="text"
            autocomplete="name"
            maxlength={SCHNUPPER_MAX_LENGTH.name}
            required
            bind:value={name}
            oninput={() => clearError('name')}
            class="form-input"
          />
        {/snippet}
      </FormField>

      <FormField
        id="{ID}-email"
        label="Deine E-Mail-Adresse"
        hint="Dorthin schicken wir den Termin."
        error={errors.email}
      >
        {#snippet children(field)}
          <input
            {...field}
            type="email"
            autocomplete="email"
            maxlength={SCHNUPPER_MAX_LENGTH.email}
            required
            bind:value={email}
            oninput={() => clearError('email')}
            class="form-input"
          />
        {/snippet}
      </FormField>

      <FormField id="{ID}-telefon" label="Telefon" optional error={errors.telefon}>
        {#snippet children(field)}
          <input
            {...field}
            type="tel"
            autocomplete="tel"
            maxlength={SCHNUPPER_MAX_LENGTH.telefon}
            bind:value={telefon}
            oninput={() => clearError('telefon')}
            class="form-input"
          />
        {/snippet}
      </FormField>

      <FormField
        id="{ID}-nachricht"
        label="Möchtest du uns noch etwas sagen?"
        optional
        error={errors.nachricht}
        class="md:col-span-2"
      >
        {#snippet children(field)}
          <textarea
            {...field}
            rows="3"
            maxlength={SCHNUPPER_MAX_LENGTH.nachricht}
            bind:value={nachricht}
            oninput={() => clearError('nachricht')}
            class="form-input"></textarea>
        {/snippet}
      </FormField>
    </fieldset>

    <!-- Honeypot for bots, hidden from humans and assistive technology -->
    <div class="hp" aria-hidden="true">
      <label for="{ID}-website">Website</label>
      <input id="{ID}-website" type="text" tabindex="-1" autocomplete="off" bind:value={website} />
    </div>

    <AltchaWidget bind:this={altchaWidget} />

    <p id="{ID}-privacy" class="text-xs text-neutral-700">
      Wir verwenden deine Angaben nur für die Schnupperstunde. Die Prüfung, ob du ein Mensch bist,
      rechnet kurz in deinem Browser – ohne Cookies und ohne Drittanbieter.
    </p>

    {#if formError}
      <p class="text-sm text-danger" role="alert">{formError}</p>
    {/if}

    <ActionButton type="submit" variant="primary" disabled={sending} aria-busy={sending}>
      {sending ? 'Wird gesendet …' : 'Schnupperstunde anfragen'}
    </ActionButton>
  </form>
{/if}

<style>
  .hp {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
</style>
