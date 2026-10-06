<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { onMount } from 'svelte';
  import { ApiError, fetchApi, sendApi } from '../../lib/api';
  import {
    getBlogPostUrl,
    getStaffBlogImageUrl,
    getUsedImages,
    toCanonicalBlogHtml,
    toEditorHtml,
    toScaledJpeg,
  } from '../../lib/blog';
  import type { BlogImage, StaffBlogPost } from '../../lib/types';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import FormField from './FormField.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Form {
    title: string;
    date: string;
    published: boolean;
    content: string;
  }

  interface ImagesResponse {
    etag: string;
    images: BlogImage[];
  }

  const LIST_URL = '/leitendenbereich/blog';
  /** Longest side of uploaded images; the largest width the website shows. */
  const IMAGE_SIZE = 1600;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const MAX_IMAGES = 30;

  let postId = $state<string | null>(null);
  let etag = $state('');
  let form = $state<Form | null>(null);
  let images = $state<BlogImage[]>([]);
  /** Form as last loaded or saved, to detect unsaved changes. */
  let saved = $state('');
  let loadError = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let imageBusy = $state<string | null>(null);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');
  let conflict = $state(false);
  let confirmDelete = $state(false);
  let editor = $state<RichTextEditor | null>(null);

  const dirty = $derived(form !== null && JSON.stringify(form) !== saved);
  const usedImages = $derived(getUsedImages(form?.content ?? ''));

  onMount(() => {
    postId = new URLSearchParams(window.location.search).get('id');
    if (postId) {
      void load(postId);
    } else {
      setForm({ title: '', date: today(), published: false, content: '' });
    }

    return guardUnsavedChanges(() => dirty);
  });

  function today(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function setForm(value: Form): void {
    form = value;
    saved = JSON.stringify(value);
  }

  async function load(id: string): Promise<void> {
    loadError = null;
    form = null;
    conflict = false;
    try {
      const post = await fetchApi<StaffBlogPost>(`/intern/pflege/blog/${encodeURIComponent(id)}`);
      etag = post.etag;
      images = post.images;
      setForm({
        title: post.title,
        date: post.date || today(),
        published: post.published,
        content: post.content,
      });
    } catch (error: unknown) {
      loadError =
        error instanceof ApiError && error.status === 404
          ? 'Diesen Beitrag gibt es nicht (mehr).'
          : 'Der Beitrag konnte nicht geladen werden.';
    }
  }

  function notify(text: string, kind: 'success' | 'warning' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
  }

  function validate(f: Form): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.title.trim()) result.title = 'Bitte einen Titel angeben.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) result.date = 'Bitte ein gültiges Datum angeben.';
    return result;
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    errors = validate(form);
    if (Object.keys(errors).length > 0) {
      notify('Bitte die markierten Felder prüfen.', 'error');
      return;
    }

    busy = true;
    message = null;
    const sent = JSON.stringify(form);
    const snapshot: Form = { ...form, content: toCanonicalBlogHtml(form.content) };
    const body = { etag, ...snapshot };
    try {
      if (postId) {
        const result = await sendApi<{ etag: string }>(
          'PATCH',
          `/intern/pflege/blog/${postId}`,
          body
        );
        etag = result.etag;
      } else {
        const result = await sendApi<{ id: string; etag: string }>(
          'POST',
          '/intern/pflege/blog',
          body
        );
        postId = result.id;
        etag = result.etag;
        history.replaceState(history.state, '', `?id=${encodeURIComponent(result.id)}`);
      }
      saved = sent;
      notify(
        snapshot.published
          ? 'Gespeichert. Der Beitrag ist auf der Website sichtbar.'
          : 'Als Entwurf gespeichert.'
      );
    } catch (error: unknown) {
      handleError(error);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!postId || busy) return;
    busy = true;
    try {
      await sendApi('DELETE', `/intern/pflege/blog/${postId}`, undefined, { etag });
      saved = JSON.stringify(form);
      window.location.href = LIST_URL;
    } catch (error: unknown) {
      handleError(error);
      busy = false;
      confirmDelete = false;
    }
  }

  function handleError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.fields) errors = { ...errors, ...error.fields };
      conflict = error.status === 409;
      notify(error.message, 'error');
    } else {
      notify('Speichern fehlgeschlagen. Bitte prüfe deine Verbindung.', 'error');
    }
  }

  function applyImages(result: ImagesResponse): void {
    etag = result.etag;
    images = result.images;
  }

  async function upload(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!postId || files.length === 0) return;
    const id = postId;

    message = null;
    for (const [index, file] of files.entries()) {
      if (images.length >= MAX_IMAGES) {
        notify(`Ein Beitrag kann höchstens ${MAX_IMAGES} Bilder haben.`, 'warning');
        break;
      }
      imageBusy = `Bild ${index + 1} von ${files.length} wird hochgeladen …`;
      try {
        const jpeg = await toScaledJpeg(file, IMAGE_SIZE);
        if (jpeg.size > MAX_IMAGE_BYTES) {
          notify(`„${file.name}“ ist zu groß.`, 'error');
          continue;
        }
        applyImages(
          await sendApi<ImagesResponse>('PUT', `/intern/pflege/blog/${id}/bilder`, jpeg, {
            etag,
          })
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) handleError(error);
        else notify(`„${file.name}“ konnte nicht als Bild gelesen werden.`, 'error');
        break;
      }
    }
    imageBusy = null;
  }

  /** Saves alt texts and order; the first image is the cover. */
  async function saveImages(next: BlogImage[]): Promise<void> {
    if (!postId) return;
    imageBusy = 'Wird gespeichert …';
    try {
      applyImages(
        await sendApi<ImagesResponse>('PATCH', `/intern/pflege/blog/${postId}/bilder`, {
          etag,
          images: next.map(({ file, alt }) => ({ file, alt })),
        })
      );
    } catch (error: unknown) {
      handleError(error);
    } finally {
      imageBusy = null;
    }
  }

  function makeCover(image: BlogImage): void {
    void saveImages([image, ...images.filter((i) => i.file !== image.file)]);
  }

  function changeAlt(image: BlogImage, alt: string): void {
    if (alt.trim() === image.alt) return;
    void saveImages(images.map((i) => (i.file === image.file ? { ...i, alt: alt.trim() } : i)));
  }

  async function removeImage(image: BlogImage): Promise<void> {
    if (!postId) return;
    imageBusy = 'Wird gelöscht …';
    try {
      applyImages(
        await sendApi<ImagesResponse>(
          'DELETE',
          `/intern/pflege/blog/${postId}/bilder/${image.file}`,
          undefined,
          { etag }
        )
      );
      // Checked before removing it from the editor, which updates `usedImages`
      const wasUsed = usedImages.has(image.file);
      editor?.removeImages(`img[data-bild="${image.file}"]`);
      notify(
        wasUsed
          ? 'Bild gelöscht. Bitte den Beitrag speichern, damit es auch im Text fehlt.'
          : 'Bild gelöscht.'
      );
    } catch (error: unknown) {
      handleError(error);
    } finally {
      imageBusy = null;
    }
  }

  function insertImage(image: BlogImage): void {
    if (!postId) return;
    editor?.insertImage({
      'data-bild': image.file,
      src: getStaffBlogImageUrl(postId, image),
      alt: image.alt,
    });
  }
</script>

{#if loadError}
  <div role="alert" class="border-l-2 border-danger py-1 pl-4">
    <p class="text-sm text-neutral-700">{loadError}</p>
    <div class="mt-4 flex gap-2">
      {#if postId}
        <ActionButton variant="primary" type="button" onclick={() => load(postId!)}>
          Erneut versuchen
        </ActionButton>
      {/if}
      <a href={LIST_URL} class="btn-secondary">Zur Übersicht</a>
    </div>
  </div>
{:else if !form}
  <div role="status" aria-live="polite" class="space-y-3">
    <span class="sr-only">Beitrag wird geladen …</span>
    <div class="skeleton-element h-12 rounded-[var(--radius-lg)]"></div>
    <div class="skeleton-element h-64 rounded-[var(--radius-lg)]"></div>
  </div>
{:else}
  <form
    class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <div class="surface space-y-5 p-4 sm:p-6">
      <FormField id="blog-title" label="Titel" error={errors.title}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="255"
            autocomplete="off"
            bind:value={form!.title}
          />
        {/snippet}
      </FormField>

      <div class="grid gap-4 sm:grid-cols-2 sm:items-end">
        <FormField
          id="blog-date"
          label="Datum"
          hint="Z. B. der Tag der Aktion; bestimmt die Reihenfolge."
          error={errors.date}
        >
          {#snippet children(attrs)}
            <input {...attrs} type="date" class="form-input" bind:value={form!.date} />
          {/snippet}
        </FormField>
        <label class="flex items-center gap-2 pb-1 text-sm font-semibold text-neutral-800">
          <input type="checkbox" bind:checked={form.published} />
          Veröffentlicht (auf der Website sichtbar)
        </label>
      </div>

      <div>
        <p id="blog-content-label" class="form-label">Text</p>
        <RichTextEditor
          bind:this={editor}
          bind:value={form.content}
          id="blog-content"
          labelledBy="blog-content-label"
          describedBy={errors.content ? 'blog-content-error' : 'blog-content-hint'}
          invalid={Boolean(errors.content)}
          features={{ headings: true, links: true }}
          sanitize={toCanonicalBlogHtml}
          toDisplay={(html) => (postId ? toEditorHtml(html, postId, images) : html)}
        />
        {#if errors.content}
          <p id="blog-content-error" class="mt-1 text-sm text-danger">
            {errors.content}
          </p>
        {:else}
          <p id="blog-content-hint" class="mt-1 text-xs text-neutral-700">
            Bilder fügst du im Bereich „Bilder“ mit „In Text einfügen“ an der Cursorposition ein.
          </p>
        {/if}
      </div>

      <StatusNotice {message} kind={messageKind} popup />
      {#if conflict && postId}
        <p class="text-sm text-neutral-700">
          Deine Änderungen sind noch nicht gespeichert. Kopiere sie bei Bedarf, bevor du
          <button
            type="button"
            class="font-semibold text-brand-800 underline"
            onclick={() => load(postId!)}
          >
            den aktuellen Stand lädst</button
          >.
        </p>
      {/if}

      <div class="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-4">
        <ActionButton variant="primary" type="submit" disabled={busy || imageBusy !== null}>
          {busy ? 'Wird gespeichert …' : postId ? 'Speichern' : 'Als Entwurf anlegen'}
        </ActionButton>
        {#if dirty}
          <span class="text-sm text-neutral-700">Ungespeicherte Änderungen</span>
        {/if}
        <span class="flex-1"></span>
        {#if postId && form.published && !dirty}
          <a href={getBlogPostUrl(postId)} class="btn-secondary" target="_blank" rel="noopener">
            Auf der Website ansehen
          </a>
        {/if}
        {#if postId}
          {#if confirmDelete}
            <span class="flex items-center gap-2 text-sm">
              Beitrag mit allen Bildern löschen?
              <ActionButton variant="danger" type="button" disabled={busy} onclick={remove}
                >Ja, löschen</ActionButton
              >
              <ActionButton
                variant="secondary"
                type="button"
                disabled={busy}
                onclick={() => (confirmDelete = false)}>Nein</ActionButton
              >
            </span>
          {:else}
            <ActionButton
              variant="danger"
              type="button"
              disabled={busy || imageBusy !== null}
              onclick={() => (confirmDelete = true)}
            >
              Löschen
            </ActionButton>
          {/if}
        {/if}
      </div>
    </div>

    <section
      aria-labelledby="blog-images-heading"
      class="space-y-4 border-t border-neutral-200 pt-5 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0"
    >
      <div class="flex items-center justify-between gap-2">
        <h2 id="blog-images-heading" class="font-serif text-xl font-semibold text-brand-900">
          Bilder
        </h2>
        {#if postId}
          <label
            class="btn-secondary cursor-pointer"
            class:opacity-60={imageBusy !== null || images.length >= MAX_IMAGES}
          >
            Hochladen
            <input
              type="file"
              accept="image/*"
              multiple
              class="sr-only"
              disabled={imageBusy !== null || images.length >= MAX_IMAGES}
              onchange={upload}
            />
          </label>
        {/if}
      </div>

      {#if !postId}
        <p class="text-sm text-neutral-700">
          Lege den Beitrag zuerst als Entwurf an, dann kannst du Bilder hinzufügen.
        </p>
      {:else}
        <p class="text-xs text-neutral-700">
          Das erste Bild ist das Titelbild für die Übersicht. Bilder werden verkleinert und sofort
          gespeichert.
        </p>
        <div role="status" aria-live="polite" class="text-sm text-neutral-700">
          {imageBusy ?? ''}
        </div>
        {#if images.length === 0}
          <p class="text-sm text-neutral-700">Noch keine Bilder.</p>
        {:else}
          <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
            {#each images as image, index (image.file)}
              <li class="space-y-2 py-4">
                <img
                  src={getStaffBlogImageUrl(postId, image)}
                  alt=""
                  width={image.width}
                  height={image.height}
                  loading="lazy"
                  class="aspect-[3/2] w-full rounded-sm object-cover"
                />
                {#if index === 0 || usedImages.has(image.file)}
                  <p class="text-sm font-semibold text-brand-900">
                    {[index === 0 ? 'Titelbild' : '', usedImages.has(image.file) ? 'Im Text' : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                {/if}
                <label class="block text-sm">
                  <span class="form-label">Bildbeschreibung</span>
                  <input
                    class="form-input"
                    maxlength="300"
                    placeholder="Was ist zu sehen?"
                    value={image.alt}
                    disabled={imageBusy !== null}
                    onchange={(event) => changeAlt(image, event.currentTarget.value)}
                  />
                </label>
                <div class="flex flex-wrap gap-2">
                  <ActionButton
                    variant="secondary"
                    type="button"
                    disabled={imageBusy !== null}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => insertImage(image)}
                  >
                    In Text einfügen
                  </ActionButton>
                  {#if index > 0}
                    <ActionButton
                      variant="secondary"
                      type="button"
                      disabled={imageBusy !== null}
                      onclick={() => makeCover(image)}
                    >
                      Als Titelbild
                    </ActionButton>
                  {/if}
                  <ActionButton
                    variant="danger"
                    type="button"
                    disabled={imageBusy !== null}
                    onclick={() => removeImage(image)}
                  >
                    Löschen
                  </ActionButton>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  </form>
{/if}
