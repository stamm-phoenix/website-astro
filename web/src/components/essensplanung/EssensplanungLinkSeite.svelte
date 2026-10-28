<script lang="ts" module>
  /**
   * A confirmation link works only once. A page change inside the site can mount the page
   * twice; both then share the first request instead of the second failing.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache, never rendered
  const bestaetigungen = new Map<string, Promise<{ token: string }>>();
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { ApiError, errorMessage, postApi } from '../../lib/api';
  import { planungUrl, tokenAusHash } from '../../lib/essensplanung';

  /**
   * The two links that lead into a Planung: `bestaetigen` (the confirmation from the mail creates
   * it) and `beitreten` (the shared link asks for a name). Both end on the Planung with the new
   * personal link.
   */

  interface Props {
    art: 'bestaetigen' | 'beitreten';
  }
  let { art }: Props = $props();

  let token = $state<string | null>(null);
  let planungName = $state<string | null>(null);
  let laden = $state(true);
  let fehler = $state<string | null>(null);
  let name = $state('');
  let email = $state('');
  let felder = $state<Record<string, string>>({});
  let busy = $state(false);

  /** Opens the Planung with the personal link; the link of this page is not kept in history. */
  function oeffne(personal: string): void {
    window.location.replace(planungUrl(personal));
  }

  onMount(() => {
    token = tokenAusHash(window.location.hash, art === 'bestaetigen' ? 'a' : 'b');
    if (!token) {
      fehler =
        'Der Link ist unvollständig. Öffne ihn bitte noch einmal aus der Mail oder Nachricht.';
      laden = false;
      return;
    }
    void (art === 'bestaetigen' ? bestaetigen(token) : ansehen(token));
  });

  async function bestaetigen(value: string): Promise<void> {
    try {
      let anfrage = bestaetigungen.get(value);
      if (!anfrage) {
        anfrage = postApi<{ token: string }>('/essensplanung/anlegen/bestaetigen', {
          token: value,
        });
        bestaetigungen.set(value, anfrage);
      }
      const result = await anfrage;
      oeffne(result.token);
    } catch (error: unknown) {
      fehler = errorMessage(error, 'Die Planung konnte nicht angelegt werden. Lade die Seite neu.');
      laden = false;
    }
  }

  async function ansehen(value: string): Promise<void> {
    try {
      planungName = (
        await postApi<{ name: string }>('/essensplanung/beitritt/ansehen', { token: value })
      ).name;
    } catch (error: unknown) {
      fehler = errorMessage(error, 'Der Link konnte nicht geprüft werden. Lade die Seite neu.');
    } finally {
      laden = false;
    }
  }

  async function beitreten(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !token) return;
    busy = true;
    felder = {};
    fehler = null;
    try {
      const result = await postApi<{ token: string }>('/essensplanung/beitritt', {
        token,
        name,
        email,
      });
      oeffne(result.token);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) felder = error.fields;
      fehler = errorMessage(error, 'Das Beitreten hat nicht geklappt. Versuche es noch einmal.');
      busy = false;
    }
  }
</script>

{#if laden}
  <p role="status" class="text-neutral-700">
    {art === 'bestaetigen' ? 'Die Planung wird angelegt …' : 'Der Link wird geprüft …'}
  </p>
{:else if art === 'beitreten' && planungName}
  <section class="surface max-w-xl space-y-4 p-5 md:p-6" aria-labelledby="ep-beitreten">
    <div class="flex items-center gap-1">
      <h2 id="ep-beitreten" class="font-serif text-xl font-bold text-brand-900">
        Bei „{planungName}“ mitplanen
      </h2>
      <InfoHint
        label="Mitplanen"
        text="Mit deinem Namen sehen die anderen, wer was geändert hat. Mit einer Mailadresse bekommst du deinen Link später über „Meine Planungen“ wieder."
      />
    </div>
    <form novalidate class="space-y-4" onsubmit={beitreten}>
      <fieldset disabled={busy} class="min-w-0 space-y-4">
        <legend class="sr-only">Beitreten</legend>
        <FormField id="ep-beitritt-name" label="Dein Name" error={felder.name}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              maxlength="100"
              autocomplete="name"
              bind:value={name}
            />
          {/snippet}
        </FormField>
        <FormField id="ep-beitritt-email" label="Deine Mailadresse" optional error={felder.email}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="email"
              class="form-input"
              autocomplete="email"
              bind:value={email}
            />
          {/snippet}
        </FormField>
        <ActionButton variant="primary" type="submit" aria-busy={busy}>
          {busy ? 'Einen Moment …' : 'Beitreten'}
        </ActionButton>
      </fieldset>
    </form>
    <StatusNotice message={fehler} kind="error" />
  </section>
{:else}
  <div class="max-w-xl space-y-4">
    <StatusNotice message={fehler} kind="error" />
    <p>
      <a class="font-semibold text-link underline" href="/essensplanung">Zur Essensplanung</a> – dort
      bekommst du unter „Meine Planungen“ neue Links.
    </p>
  </div>
{/if}
