<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import FotoBrowser from './FotoBrowser.svelte';
  import FotoUpload from './FotoUpload.svelte';
  import FotoZipStatus from './FotoZipStatus.svelte';
  import { clearFotoDownloadResult } from '../../lib/fotoDownload.svelte';
  import { fotoAnsichtHash, readFotoAnsicht, type FotoAnsicht } from '../../lib/fotoAnsicht';
  import {
    cancelFotoUpload,
    fotoUpload,
    fotoUploadActive,
    fotoUploadDraft,
    hasFotoDraft,
    presetFotoFolder,
    resetFotoUpload,
    uploadTotals,
  } from '../../lib/fotoUpload.svelte';
  import { fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { loadFotoFolder } from '../../lib/fotoOrdnerStore.svelte';
  import { aktionenPflege } from '../../lib/pflegeStore.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';

  type Tab = 'ansehen' | 'hochladen';

  const initial = readFotoAnsicht(window.location.hash);
  if (initial.upload && initial.ziel !== null) presetFotoFolder(initial.ziel);
  let view = $state<FotoAnsicht>(initial);
  /** Folder shown last, for the way back from the upload. */
  let lastPath = $state(initial.path);
  /** Whether the open photo has its own history entry from this page. */
  let opened = false;

  const uploading = $derived(fotoUpload.phase === 'preparing' || fotoUpload.phase === 'running');
  const tabs = $derived<{ value: Tab; label: string }[]>([
    { value: 'ansehen', label: 'Fotos ansehen' },
    {
      value: 'hochladen',
      label: uploading
        ? `Hochladen (${Math.floor((uploadTotals.sent / (uploadTotals.bytes || 1)) * 100)} %)`
        : 'Hochladen',
    },
  ]);

  onMount(() => {
    // The Aktionen take a while to load. They are only needed for the upload, so they follow the
    // folder shown first (the upload form loads them itself) and are there when it is opened
    const preloadAktionen = (): void => {
      void fetchCampflowEvents();
      void aktionenPflege.load();
    };
    if (initial.upload) preloadAktionen();
    else void loadFotoFolder(initial.path).finally(preloadAktionen);
    const read = (): void => {
      view = readFotoAnsicht(window.location.hash);
      if (!view.upload) lastPath = view.path;
      // Back or forward to the form of another folder: the form takes that folder again
      else if (
        view.ziel !== null &&
        (fotoUploadDraft.mode !== 'ordner' || fotoUploadDraft.folder !== view.ziel)
      ) {
        prepareTarget(view.ziel);
      }
    };
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    const unguard = guardUnsavedChanges(fotoUploadActive, {
      title: 'Hochladen abbrechen?',
      message:
        'Es werden noch Fotos hochgeladen. Wenn du die Seite verlässt, bricht das Hochladen ab. Fertige Dateien bleiben in der Ablage.',
      confirmLabel: 'Seite verlassen',
      cancelLabel: 'Hier bleiben',
    });
    const unguardDraft = guardUnsavedChanges(hasFotoDraft, {
      title: 'Fotos noch nicht hochgeladen',
      message:
        'Von deinen ausgewählten Fotos sind noch nicht alle in der Ablage. Wenn du die Seite verlässt, musst du sie neu auswählen.',
      confirmLabel: 'Seite verlassen',
      cancelLabel: 'Hier bleiben',
    });
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
      unguard();
      unguardDraft();
      // Leaving the page was confirmed; nothing would show the upload or the choice any more
      cancelFotoUpload();
      fotoUploadDraft.files = [];
    };
  });

  /** The upload form for a folder, as from „Hierher hochladen“. */
  function prepareTarget(ziel: string): void {
    // A finished, cancelled or failed upload makes room for the new target instead of showing
    // its result again; files that did not arrive stay chosen. A running one goes on.
    if (fotoUpload.phase !== 'idle' && !fotoUploadActive()) {
      resetFotoUpload({ keepSelection: hasFotoDraft() });
    }
    presetFotoFolder(ziel);
  }

  /** Shows another view; a hash keeps the page and gives the back button a step. */
  function go(next: Partial<FotoAnsicht>, replace = false): void {
    const target: FotoAnsicht = { path: view.path, foto: null, upload: false, ziel: null, ...next };
    if (target.upload && target.ziel !== null) prepareTarget(target.ziel);
    // The result of a finished ZIP belongs to the view it was started in
    if (target.path !== view.path || target.upload !== view.upload) clearFotoDownloadResult();
    view = target;
    if (!target.upload) lastPath = target.path;
    void navigate(fotoAnsichtHash(target), { history: replace ? 'replace' : 'push' });
  }

  function openFolder(path: string): void {
    go({ path });
    window.scrollTo({ top: 0 });
  }

  function openFoto(id: string | null): void {
    if (id === null) {
      // Back to the entry before the photo was opened, if it was opened here
      if (opened) {
        opened = false;
        history.back();
      } else go({ path: view.path }, true);
      return;
    }
    // Swiping replaces the photo, so one step back closes the view
    const replace = view.foto !== null;
    if (!replace) opened = true;
    go({ path: view.path, foto: id }, replace);
  }
</script>

<div class="space-y-3">
  <FilterTabs
    label="Ansicht"
    variant="segmented"
    options={tabs}
    value={view.upload ? 'hochladen' : 'ansehen'}
    onselect={(tab) =>
      tab === 'hochladen' ? go({ upload: true, ziel: null }) : openFolder(lastPath)}
  />

  {#if view.upload}
    <FotoZipStatus />
    <FotoUpload onshow={openFolder} />
  {:else}
    <FotoBrowser
      path={view.path}
      foto={view.foto}
      onnavigate={openFolder}
      onopen={openFoto}
      onupload={(path) => go({ upload: true, ziel: path })}
    />
    <FotoZipStatus sticky />
  {/if}
</div>
