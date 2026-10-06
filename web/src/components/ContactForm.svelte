<script lang="ts">
  import type {} from 'altcha/types/svelte';
  import type { WidgetMethods } from 'altcha/types';
  import FormField from './pflege/FormField.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import { ApiError, postApi } from '../lib/api';
  import { KONTAKT_MAX_LENGTH, KONTAKT_TOPICS, validateKontaktMessage } from '../lib/kontaktConfig';
  import type { KontaktField } from '../lib/kontaktConfig';
  import type { KontaktSent } from '../lib/types';

  const ID = 'kontakt';
  const FIELD_ORDER: KontaktField[] = ['name', 'email', 'topic', 'message'];

  let name = $state('');
  let email = $state('');
  /** Links like `/kontakt?thema=gruppenstunden` preselect the topic; the island only runs in the browser. */
  const presetTopic = new URLSearchParams(window.location.search).get('thema');
  let topic = $state(
    KONTAKT_TOPICS.some((option) => option.id === presetTopic) ? presetTopic! : ''
  );
  let message = $state('');
  let website = $state('');

  let errors = $state<Partial<Record<KontaktField, string>>>({});
  let formError = $state<string | null>(null);
  let sending = $state(false);
  let sentTo = $state<string | null>(null);
  /** Whether the receipt mail went out; the message has arrived either way. */
  let receiptSent = $state(true);

  let widget = $state<(HTMLElement & WidgetMethods) | null>(null);
  let payload: string | null = null;

  $effect(() => {
    // The widget touches the DOM when it loads, so it is only imported in the browser.
    void Promise.all([import('altcha'), import('altcha/i18n/de')]);
  });

  /** Keeps the widget payload only while its state is verified. */
  function onStateChange(event: CustomEvent<{ payload?: string; state: string }>): void {
    payload = event.detail.state === 'verified' ? (event.detail.payload ?? null) : null;
  }

  /** Clears the edited field's error and the form-wide error. */
  function clearError(field: KontaktField): void {
    if (errors[field]) errors = { ...errors, [field]: undefined };
    formError = null;
  }

  /** Focuses the first invalid field in display order, if its element exists. */
  function focusFirstError(): void {
    const field = FIELD_ORDER.find((key) => errors[key]);
    if (field) document.getElementById(`${ID}-${field}`)?.focus();
  }

  /**
   * Returns the solved proof of work; starts it if the visitor submits before it finished.
   * Returns null if the widget is absent, verification throws, or no payload is returned.
   */
  async function proofOfWork(): Promise<string | null> {
    if (payload) return payload;
    if (!widget) return null;
    try {
      return (await widget.verify())?.payload ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Prevents native submission and concurrent sends, validates fields, then posts with proof
   * of work. Updates success or error state and focuses invalid fields. API failures become
   * form errors; after a valid submission attempt, clears the proof and resets the widget.
   */
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (sending) return;

    const validation = validateKontaktMessage({ name, email, topic, message });
    errors = validation.errors;
    if (!validation.message) {
      focusFirstError();
      return;
    }

    formError = null;
    sending = true;
    try {
      const altcha = await proofOfWork();
      if (!altcha) {
        formError =
          'Die Prüfung, ob du ein Mensch bist, hat nicht geklappt. Bitte setz das Häkchen und versuch es noch einmal.';
        return;
      }
      const result = await postApi<KontaktSent>('/kontakt', {
        ...validation.message,
        website,
        altcha,
      });
      receiptSent = result.receipt;
      sentTo = validation.message.email;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.fields) {
        errors = err.fields as Partial<Record<KontaktField, string>>;
        focusFirstError();
      }
      formError =
        err instanceof ApiError && err.code
          ? err.message
          : 'Das hat leider nicht geklappt. Bitte versuch es später noch einmal oder schreib uns direkt an kontakt@stamm-phoenix.de.';
    } finally {
      sending = false;
      // Each solved challenge is accepted only once.
      payload = null;
      widget?.reset();
    }
  }
</script>

{#if sentTo}
  <div
    class="border-l-4 border-success bg-success-soft px-4 py-3 text-sm text-neutral-900"
    role="status"
  >
    <p><strong>Danke für deine Nachricht!</strong> Sie ist bei uns angekommen.</p>
    {#if receiptSent}
      <p class="mt-2">
        Wir haben dir eine Bestätigung an <strong>{sentTo}</strong> geschickt und melden uns so bald wie
        möglich. Keine E-Mail erhalten? Dann schau bitte im Spam-Ordner nach oder prüf, ob die Adresse
        stimmt – unsere Antwort geht an genau diese Adresse.
      </p>
    {:else}
      <p class="mt-2">
        Die Bestätigungs-Mail an <strong>{sentTo}</strong> konnte gerade nicht verschickt werden. Du musst
        nichts weiter tun: Wir melden uns so bald wie möglich an diese Adresse.
      </p>
    {/if}
  </div>
{:else}
  <form class="space-y-5" novalidate onsubmit={submit} aria-describedby="{ID}-privacy">
    <div class="grid gap-5 md:grid-cols-2">
      <FormField id="{ID}-name" label="Dein Name" error={errors.name}>
        {#snippet children(field)}
          <input
            {...field}
            type="text"
            autocomplete="name"
            maxlength={KONTAKT_MAX_LENGTH.name}
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
        hint="Dorthin schicken wir unsere Antwort."
        error={errors.email}
      >
        {#snippet children(field)}
          <input
            {...field}
            type="email"
            autocomplete="email"
            maxlength={KONTAKT_MAX_LENGTH.email}
            required
            bind:value={email}
            oninput={() => clearError('email')}
            class="form-input"
          />
        {/snippet}
      </FormField>

      <FormField id="{ID}-topic" label="Worum geht es?" error={errors.topic} class="md:col-span-2">
        {#snippet children(field)}
          <select
            {...field}
            required
            bind:value={topic}
            onchange={() => clearError('topic')}
            class="form-input"
          >
            <option value="" disabled>Bitte auswählen</option>
            {#each KONTAKT_TOPICS as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        {/snippet}
      </FormField>

      <FormField
        id="{ID}-message"
        label="Deine Nachricht"
        error={errors.message}
        class="md:col-span-2"
      >
        {#snippet children(field)}
          <textarea
            {...field}
            rows="6"
            maxlength={KONTAKT_MAX_LENGTH.message}
            required
            bind:value={message}
            oninput={() => clearError('message')}
            class="form-input"></textarea>
        {/snippet}
      </FormField>
    </div>

    <!-- Honeypot for bots, hidden from humans and assistive technology -->
    <div class="hp" aria-hidden="true">
      <label for="{ID}-website">Website</label>
      <input id="{ID}-website" type="text" tabindex="-1" autocomplete="off" bind:value={website} />
    </div>

    <altcha-widget
      bind:this={widget}
      challenge="/api/kontakt/challenge"
      auto="onfocus"
      language="de"
      onstatechange={onStateChange}
    ></altcha-widget>

    <p id="{ID}-privacy" class="text-xs text-neutral-700">
      Wir verwenden deine Angaben nur, um deine Anfrage zu beantworten. Die Prüfung, ob du ein
      Mensch bist, rechnet kurz in deinem Browser – ohne Cookies und ohne Drittanbieter.
    </p>

    {#if formError}
      <p class="text-sm text-danger" role="alert">{formError}</p>
    {/if}

    <ActionButton type="submit" variant="primary" disabled={sending} aria-busy={sending}>
      {sending ? 'Wird gesendet …' : 'Nachricht senden'}
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
  altcha-widget {
    display: block;
    /* Theme tokens, so the widget follows the light and dark theme. */
    --altcha-color-base: var(--color-field);
    --altcha-color-base-content: var(--color-neutral-900);
    --altcha-color-neutral: var(--field-border);
    --altcha-color-primary: var(--color-action);
    --altcha-color-primary-content: var(--color-on-action);
    --altcha-color-error: var(--color-danger);
    --altcha-color-success: var(--color-success);
    --altcha-border-radius: var(--radius-sm);
    --altcha-checkbox-border-radius: var(--radius-sm);
    --altcha-input-border-radius: var(--radius-sm);
    --altcha-max-width: 100%;
  }
</style>
