<script lang="ts">
  import Toast from './ui/Toast.svelte';
  import {
    favoritesStore,
    restoreFavorite,
    saveFavorites,
  } from '../lib/staffFavoritesStore.svelte';
</script>

<!-- Keep the live region mounted inside the menu, also before a save fails. -->
<Toast
  message={favoritesStore.notice?.text ?? null}
  kind={favoritesStore.notice?.kind}
  actionLabel={favoritesStore.notice?.kind === 'error'
    ? 'Erneut speichern'
    : favoritesStore.notice?.undo
      ? 'Rückgängig'
      : undefined}
  duration={favoritesStore.notice?.kind === 'error' ? 0 : undefined}
  onaction={() => {
    const undo = favoritesStore.notice?.undo;
    if (undo) restoreFavorite(undo);
    else saveFavorites();
  }}
  onclose={() => (favoritesStore.notice = null)}
/>
