<script lang="ts">
  import { untrack } from 'svelte';
  import AltchaWidget from './AltchaWidget.svelte';
  import FormField from './pflege/FormField.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import { ApiError, postApi } from '../lib/api';
  import {
    PROBLEM_MAX_LENGTH,
    cleanProblemContext,
    describeBrowser,
    validateProblemReport,
  } from '../lib/problemMelden';
  import { problemModuleOf } from '../lib/problemModul';
  import type { ProblemContext, ProblemField, ProblemSent } from '../lib/problemMelden';

  interface Props {
    /** Short commit of this build, known only when the site is built. */
    version?: string;
  }
  let { version = '' }: Props = $props();

  const ID = 'problem';
  const FIELD_ORDER: ProblemField[] = ['description', 'steps', 'expected', 'contact'];
  const MAIL = 'kontakt@stamm-phoenix.de';

  const params = new URLSearchParams(window.location.search);
  const entry = params.get('quelle') === 'fehler' ? 'fehler' : 'footer';

  /** Where the problem happened: the page the link was on. */
  const page = params.get('seite') ?? '';
  /** What is sent along; cleaned the same way on the server. */
  const context: ProblemContext = cleanProblemContext({
    page,
    module: params.get('modul') ?? problemModuleOf(page),
    errorCode: params.get('code'),
    httpStatus: params.get('status'),
    action: params.get('route'),
    correlationId: params.get('korrelation'),
    appVersion: untrack(() => version),
    browser: describeBrowser(navigator.userAgent),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  });
  const details = [
    { name: 'Seite', value: context.page },
    { name: 'Bereich', value: context.module },
    { name: 'Fehlercode', value: context.errorCode },
    { name: 'Status', value: context.httpStatus === null ? '' : String(context.httpStatus) },
    { name: 'Aktion', value: context.action },
    { name: 'Nummer der Anfrage', value: context.correlationId },
    { name: 'Browser', value: context.browser },
    { name: 'Fenstergröße', value: context.viewport },
    { name: 'Version', value: context.appVersion },
  ].filter((detail) => detail.value !== '');

  let description = $state('');
  let steps = $state('');
  let expected = $state('');
  let contact = $state('');
  let website = $state('');

  let errors = $state<Partial<Record<ProblemField, string>>>({});
  let formError = $state<string | null>(null);
  let sending = $state(false);
  let sentId = $state<string | null>(null);

  let altchaWidget = $state<AltchaWidget | null>(null);

  /** Clears the edited field's error and the form-wide error. */
  function clearError(field: ProblemField): void {
    if (errors[field]) errors = { ...errors, [field]: undefined };
    formError = null;
  }

  function focusFirstError(): void {
    const field = FIELD_ORDER.find((key) => errors[key]);
    if (field) document.getElementById(`${ID}-${field}`)?.focus();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (sending) return;

    const validation = validateProblemReport({
      entry,
      description,
      steps,
      expected,
      contact,
      context,
    });
    errors = validation.errors;
    if (!validation.report) {
      focusFirstError();
      return;
    }

    formError = null;
    sending = true;
    try {
      const altcha = (await altchaWidget?.solve()) ?? null;
      if (!altcha) {
        formError =
          'Die Prüfung, ob du ein Mensch bist, hat nicht geklappt. Bitte setz das Häkchen und tippe noch einmal auf „Problem melden“.';
        return;
      }
      const result = await postApi<ProblemSent>('/problemmeldung', {
        ...validation.report,
        website,
        altcha,
      });
      sentId = result.id;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.fields) {
        errors = err.fields as Partial<Record<ProblemField, string>>;
        focusFirstError();
      }
      formError =
        err instanceof ApiError && err.code
          ? err.message
          : `Deine Meldung wurde nicht gesendet. Deine Eingaben sind noch da. Prüf deine Internetverbindung und tippe noch einmal auf „Problem melden“. Hilft das nicht, schreib uns an ${MAIL}.`;
    } finally {
      sending = false;
      // Each solved challenge is accepted only once.
      altchaWidget?.reset();
    }
  }
</script>

{#if sentId}
  <div
    class="border-l-4 border-success bg-success-soft px-4 py-3 text-sm text-neutral-900"
    role="status"
  >
    <p><strong>Danke, deine Meldung ist angekommen.</strong></p>
    <p class="mt-2">Meldungsnummer: <strong>{sentId}</strong></p>
  </div>
  <p class="mt-4">
    <a class="text-link inline-flex min-h-11 items-center" href="/">Zur Startseite</a>
  </p>
{:else}
  <form class="space-y-5" novalidate onsubmit={submit}>
    <!-- While the report is sent, the fields stay as they were captured: nothing typed is lost -->
    <fieldset disabled={sending} class="min-w-0 space-y-5">
      <legend class="sr-only">Dein Problem</legend>
      <FormField id="{ID}-description" label="Was ist das Problem?" error={errors.description}>
        {#snippet children(field)}
          <textarea
            {...field}
            rows="5"
            maxlength={PROBLEM_MAX_LENGTH.description}
            required
            bind:value={description}
            oninput={() => clearError('description')}
            class="form-input"></textarea>
        {/snippet}
      </FormField>

      <FormField id="{ID}-steps" label="Was hast du vorher gemacht?" optional error={errors.steps}>
        {#snippet children(field)}
          <textarea
            {...field}
            rows="3"
            maxlength={PROBLEM_MAX_LENGTH.steps}
            placeholder="1. Gruppenstunden öffnen&#10;2. Auf „Wölflinge“ tippen"
            bind:value={steps}
            oninput={() => clearError('steps')}
            class="form-input"></textarea>
        {/snippet}
      </FormField>

      <FormField id="{ID}-expected" label="Was hast du erwartet?" optional error={errors.expected}>
        {#snippet children(field)}
          <textarea
            {...field}
            rows="2"
            maxlength={PROBLEM_MAX_LENGTH.expected}
            bind:value={expected}
            oninput={() => clearError('expected')}
            class="form-input"></textarea>
        {/snippet}
      </FormField>

      <FormField
        id="{ID}-contact"
        label="Deine E-Mail-Adresse für Rückfragen"
        optional
        error={errors.contact}
      >
        {#snippet children(field)}
          <input
            {...field}
            type="email"
            autocomplete="email"
            maxlength={PROBLEM_MAX_LENGTH.contact}
            bind:value={contact}
            oninput={() => clearError('contact')}
            class="form-input"
          />
        {/snippet}
      </FormField>
    </fieldset>

    {#if details.length > 0}
      <section aria-labelledby="{ID}-details" class="surface-muted p-4 text-sm">
        <h2 id="{ID}-details" class="font-semibold text-brand-900">
          Diese Angaben schicken wir mit
        </h2>
        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {#each details as detail (detail.name)}
            <dt class="text-neutral-700">{detail.name}</dt>
            <dd class="min-w-0 break-words [overflow-wrap:anywhere]">{detail.value}</dd>
          {/each}
        </dl>
      </section>
    {/if}

    <!-- Honeypot for bots, hidden from humans and assistive technology -->
    <div class="hp" aria-hidden="true">
      <label for="{ID}-website">Website</label>
      <input id="{ID}-website" type="text" tabindex="-1" autocomplete="off" bind:value={website} />
    </div>

    <AltchaWidget bind:this={altchaWidget} />

    {#if formError}
      <p class="text-sm text-danger" role="alert">{formError}</p>
    {/if}

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ActionButton type="submit" variant="primary" disabled={sending} aria-busy={sending}>
        {sending ? 'Wird gesendet …' : 'Problem melden'}
      </ActionButton>
      <a
        class="text-link inline-flex min-h-11 items-center text-sm"
        href="/datenschutz#problem-melden">Was mit deiner Meldung passiert</a
      >
    </div>
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
