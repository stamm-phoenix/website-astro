<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import Postfach from './Postfach.svelte';
  import { authStore, fetchPrincipal } from '../../lib/authStore.svelte';
  import { postfachListe, postfachStart } from '../../lib/postfachStore.svelte';
  import { postfachAusAdresse, postfachHref, postfachKurzname } from '../../lib/postfaecher';
  import { POSTFAECHER, findPostfach, postfachRoles } from '../../../../api/lib/postfach-liste';

  /**
   * The module „Postfächer“: one shared mailbox at a time, chosen above the list among those the
   * person sees. The choice sits in the address (`?postfach=`), so links from the start page and
   * from the note mails open the right one.
   */

  const gewaehlt = postfachAusAdresse(window.location.search);
  const eintrag = findPostfach(gewaehlt) ?? POSTFAECHER[0];

  const start = postfachStart.state;
  const liste = postfachListe.state;
  /** The open mailbox counts from its own list, so a change or „Neu laden“ shows at once. */
  const neuHier = $derived(
    liste.data?.postfach.id === gewaehlt
      ? liste.data.konversationen.filter((zeile) => zeile.status === 'neu').length
      : undefined
  );
  /** Before the API answered, the roles of the login decide; the API has the last word. */
  const nachRollen = $derived(
    POSTFAECHER.filter((postfach) =>
      postfachRoles(postfach).some((role) => authStore.principal?.userRoles.includes(role))
    )
  );
  const optionen = $derived(
    (start.data?.postfaecher ?? nachRollen).map((postfach) => {
      const neu =
        postfach.id === gewaehlt && neuHier !== undefined
          ? neuHier
          : start.data?.postfaecher.find((p) => p.id === postfach.id)?.neu;
      return {
        value: postfach.id,
        label: postfachKurzname(postfach),
        count: neu ? neu : undefined,
      };
    })
  );

  function waehle(id: string): void {
    if (id === gewaehlt) return;
    void navigate(postfachHref(id));
  }

  onMount(() => {
    void fetchPrincipal().then(() => {
      // The counts are only worth a request where there is a choice
      if (nachRollen.length > 1) void postfachStart.load({ force: true });
    });
  });
</script>

<Postfach postfach={eintrag.id} address={eintrag.address}>
  {#snippet auswahl()}
    {#if optionen.length > 1}
      <FilterTabs
        label="Postfach"
        showLabel
        variant="segmented"
        options={optionen}
        value={gewaehlt}
        onselect={waehle}
        countStyle="badge"
        countNouns={['neue E-Mail', 'neue E-Mails']}
      />
    {/if}
  {/snippet}
</Postfach>
