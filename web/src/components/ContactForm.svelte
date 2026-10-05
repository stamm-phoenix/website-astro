<script lang="ts">
  import type {} from 'altcha/types/svelte';
  import type { WidgetMethods } from 'altcha/types';
  import { ApiError, postApi } from '../lib/api';
  import { KONTAKT_MAX_LENGTH, KONTAKT_TOPICS, validateKontaktMessage } from '../lib/kontaktConfig';
  import type { KontaktField } from '../lib/kontaktConfig';
  import type { KontaktSent } from '../lib/types';

  const ID = 'kontakt';
  const FIELD_ORDER: KontaktField[] = ['name', 'email', 'topic', 'message'];

  let name = $state('');
  let email = $state('');
  let topic = $state('');
  let message = $state('');
  let website = $state('');

  let errors = $state<Partial<Record<KontaktField, string>>>({});
  let formError = $state<string | null>(null);
  let sending = $state(false);
  let sentTo = $state<string | null>(null);

  let widget = $state<(HTMLElement & WidgetMethods) | null>(null);
  let payload: string | null = null;

  $effect(() => {
    // The widget touches the DOM when it loads, so it is only imported in the browser.
    void Promise.all([import('altcha'), import('altcha/i18n/de')]);
  });

  function onStateChange(event: CustomEvent<{ payload?: string; state: string }>): void {
    payload = event.detail.state === 'verified' ? (event.detail.payload ?? null) : null;
  }

  function clearError(field: KontaktField): void {
    if (errors[field]) errors = { ...errors, [field]: undefined };
    formError = null;
  }

  function focusFirstError(): void {
    const field = FIELD_ORDER.find((key) => errors[key]);
    if (field) document.getElementById(`${ID}-${field}`)?.focus();
  }

  function inputClass(hasError: boolean): string {
    return [
      'mt-1 block w-full rounded-md border bg-white px-3 py-2.5 text-base text-neutral-900 shadow-sm',
      'focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]',
      hasError ? 'border-[var(--color-dpsg-red)]' : 'border-neutral-300',
    ].join(' ');
  }

  function describedBy(field: KontaktField, hint = false): string | undefined {
    const ids = [hint && `${ID}-${field}-hint`, errors[field] && `${ID}-${field}-error`];
    const joined = ids.filter(Boolean).join(' ');
    return joined || undefined;
  }

  /** The solved proof of work; starts it if the visitor submits before it finished. */
  async function proofOfWork(): Promise<string | null> {
    if (payload) return payload;
    if (!widget) return null;
    try {
      return (await widget.verify())?.payload ?? null;
    } catch {
      return null;
    }
  }

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
      await postApi<KontaktSent>('/kontakt', { ...validation.message, website, altcha });
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

{#snippet fieldError(field: KontaktField)}
  {#if errors[field]}
    <p id="{ID}-{field}-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
      {errors[field]}
    </p>
  {/if}
{/snippet}

{#if sentTo}
  <div
    class="rounded-md border border-[var(--color-dpsg-pfadfinder)]/30 bg-[var(--color-dpsg-pfadfinder)]/5 px-4 py-3 text-sm text-neutral-800"
    role="status"
  >
    <p><strong>Danke für deine Nachricht!</strong> Sie ist bei uns angekommen.</p>
    <p class="mt-2 text-neutral-700">
      Wir haben dir eine Bestätigung an <strong>{sentTo}</strong> geschickt und melden uns so bald wie
      möglich. Keine E-Mail erhalten? Dann schau bitte im Spam-Ordner nach oder prüf, ob die Adresse stimmt
      – unsere Antwort geht an genau diese Adresse.
    </p>
  </div>
{:else}
  <form class="space-y-5" novalidate onsubmit={submit} aria-describedby="{ID}-privacy">
    <div class="grid gap-5 md:grid-cols-2">
      <div>
        <label for="{ID}-name" class="label">Dein Name</label>
        <input
          id="{ID}-name"
          type="text"
          autocomplete="name"
          maxlength={KONTAKT_MAX_LENGTH.name}
          required
          bind:value={name}
          oninput={() => clearError('name')}
          class={inputClass(!!errors.name)}
          aria-invalid={errors.name ? 'true' : undefined}
          aria-describedby={describedBy('name')}
        />
        {@render fieldError('name')}
      </div>

      <div>
        <label for="{ID}-email" class="label">Deine E-Mail-Adresse</label>
        <input
          id="{ID}-email"
          type="email"
          autocomplete="email"
          maxlength={KONTAKT_MAX_LENGTH.email}
          required
          bind:value={email}
          oninput={() => clearError('email')}
          class={inputClass(!!errors.email)}
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={describedBy('email', true)}
        />
        <p id="{ID}-email-hint" class="mt-1 text-xs text-neutral-700">
          Dorthin schicken wir unsere Antwort.
        </p>
        {@render fieldError('email')}
      </div>

      <div class="md:col-span-2">
        <label for="{ID}-topic" class="label">Worum geht es?</label>
        <select
          id="{ID}-topic"
          required
          bind:value={topic}
          onchange={() => clearError('topic')}
          class={inputClass(!!errors.topic)}
          aria-invalid={errors.topic ? 'true' : undefined}
          aria-describedby={describedBy('topic')}
        >
          <option value="" disabled>Bitte auswählen</option>
          {#each KONTAKT_TOPICS as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
        {@render fieldError('topic')}
      </div>

      <div class="md:col-span-2">
        <label for="{ID}-message" class="label">Deine Nachricht</label>
        <textarea
          id="{ID}-message"
          rows="6"
          maxlength={KONTAKT_MAX_LENGTH.message}
          required
          bind:value={message}
          oninput={() => clearError('message')}
          class={inputClass(!!errors.message)}
          aria-invalid={errors.message ? 'true' : undefined}
          aria-describedby={describedBy('message')}></textarea>
        {@render fieldError('message')}
      </div>
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
      <p class="text-sm text-[var(--color-dpsg-red)]" role="alert">{formError}</p>
    {/if}

    <button
      type="submit"
      class="inline-flex items-center justify-center rounded-full bg-[var(--color-brand-800)] px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-dpsg-red)]"
      disabled={sending}
      aria-busy={sending}
    >
      {sending ? 'Wird gesendet …' : 'Nachricht senden'}
    </button>
  </form>
{/if}

<style>
  .label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .hp {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  altcha-widget {
    display: block;
    --altcha-color-primary: var(--color-brand-800);
    --altcha-border-radius: 0.375rem;
    --altcha-max-width: 100%;
  }
</style>
