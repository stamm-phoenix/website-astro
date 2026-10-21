<script lang="ts">
  import MessageText from '../ui/MessageText.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import { ApiError, errorMessage, fetchApi, sendApi } from '../../lib/api';
  import { todayIso } from '../../lib/format';
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
  import TextEditor from '../ui/TextEditor.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { confirmAction } from '../../lib/confirm';

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
  let published = $state(false);
  let loadError = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let imageBusy = $state<string | null>(null);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');
  let conflict = $state(false);
  let editor = $state<TextEditor | null>(null);

  const dirty = $derived(form !== null && JSON.stringify(form) !== saved);
  const usedImages = $derived(getUsedImages(form?.content ?? ''));

  onMount(() => {
    postId = new URLSearchParams(window.location.search).get('id');
    if (postId) {
      void load(postId);
    } else {
      setForm({ title: '', date: todayIso(), published: false, content: '' });
    }

    return guardUnsavedChanges(() => dirty || busy || imageBusy !== null);
  });

  function setForm(value: Form): void {
    published = value.published;
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
        date: post.date || todayIso(),
        published: post.published,
        content: post.content,
      });
    } catch (error: unknown) {
      loadError =
        error instanceof ApiError && error.status === 404
          ? 'Diesen Beitrag gibt es nicht (mehr).'
          : errorMessage(
              error,
              'Der Beitrag konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
            );
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

  async function save(targetPublished = published): Promise<void> {
    if (!form || busy || imageBusy !== null) return;
    errors = validate(form);
    if (Object.keys(errors).length > 0) {
      notify('Bitte die markierten Felder prüfen.', 'error');
      return;
    }

    busy = true;
    message = null;
    const sent = JSON.stringify({ ...form, published: targetPublished });
    const snapshot: Form = {
      ...form,
      published: targetPublished,
      content: toCanonicalBlogHtml(form.content),
    };
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
      published = snapshot.published;
      form.published = snapshot.published;
      saved = sent;
      notify(
        snapshot.published
          ? 'Der Beitrag ist jetzt auf der Website sichtbar.'
          : 'Als Entwurf gespeichert. Der Beitrag ist nur hier sichtbar.'
      );
    } catch (error: unknown) {
      handleError(error);
    } finally {
      busy = false;
    }
  }

  async function changePublication(): Promise<void> {
    if (!form || busy || imageBusy !== null) return;
    const next = !published;
    const title = form.title.trim() || 'Ohne Titel';
    const confirmed = await confirmAction({
      title: next
        ? `Beitrag „${title}“ veröffentlichen?`
        : `Veröffentlichung von „${title}“ zurücknehmen?`,
      message: next
        ? 'Der Beitrag wird mit deinen aktuellen Eingaben auf der Website für alle sichtbar.'
        : 'Der Beitrag wird mit deinen aktuellen Eingaben als Entwurf gespeichert. Er ist danach nur noch hier sichtbar.',
      confirmLabel: next ? 'Veröffentlichen' : 'Veröffentlichung zurücknehmen',
      tone: 'neutral',
    });
    if (confirmed) await save(next);
  }

  $effect(() => {
    document.title = `${postId ? 'Beitrag bearbeiten' : 'Neuer Beitrag'} | Leitendenbereich | Stamm Phoenix`;
  });

  async function remove(): Promise<void> {
    if (!postId || busy) return;
    busy = true;
    try {
      await sendApi('DELETE', `/intern/pflege/blog/${postId}`, undefined, { etag });
      saved = JSON.stringify(form);
      busy = false;
      await navigate(`${LIST_URL}?geloescht=1`);
    } catch (error: unknown) {
      handleError(
        error,
        'Der Beitrag wurde nicht gelöscht. Prüfe deine Internetverbindung und tippe noch einmal auf „Löschen“.'
      );
      busy = false;
    }
  }

  function handleError(
    error: unknown,
    fallback = 'Der Beitrag wurde nicht gespeichert. Deine Eingaben sind noch da. Prüfe deine Internetverbindung und versuche es noch einmal.'
  ): void {
    if (error instanceof ApiError) {
      if (error.fields) errors = { ...errors, ...error.fields };
      conflict = error.status === 409;
    }
    notify(errorMessage(error, fallback), 'error');
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
      let jpeg: Blob;
      try {
        jpeg = await toScaledJpeg(file, IMAGE_SIZE);
      } catch {
        notify(`„${file.name}“ konnte nicht als Bild gelesen werden.`, 'error');
        break;
      }
      if (jpeg.size > MAX_IMAGE_BYTES) {
        notify(`„${file.name}“ ist zu groß.`, 'error');
        continue;
      }
      try {
        applyImages(
          await sendApi<ImagesResponse>('PUT', `/intern/pflege/blog/${id}/bilder`, jpeg, {
            etag,
          })
        );
      } catch (error: unknown) {
        handleError(
          error,
          `Das Bild „${file.name}“ wurde nicht hochgeladen. Prüfe deine Internetverbindung und wähle es noch einmal aus.`
        );
        break;
      }
    }
    imageBusy = null;
  }

  /** Saves order and descriptions of the images and confirms with `done`. */
  async function saveImages(next: BlogImage[], done: string): Promise<void> {
    if (!postId) return;
    imageBusy = 'Wird gespeichert …';
    try {
      applyImages(
        await sendApi<ImagesResponse>('PATCH', `/intern/pflege/blog/${postId}/bilder`, {
          etag,
          images: next.map(({ file, alt }) => ({ file, alt })),
        })
      );
      notify(done);
    } catch (error: unknown) {
      handleError(
        error,
        'Die Bildangaben wurden nicht gespeichert. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
    } finally {
      imageBusy = null;
    }
  }

  function makeCover(image: BlogImage): void {
    void saveImages(
      [image, ...images.filter((i) => i.file !== image.file)],
      'Titelbild geändert. Es steht jetzt als erstes Bild in der Liste.'
    );
  }

  function changeAlt(image: BlogImage, alt: string): void {
    if (alt.trim() === image.alt) return;
    void saveImages(
      images.map((i) => (i.file === image.file ? { ...i, alt: alt.trim() } : i)),
      'Bildbeschreibung gespeichert.'
    );
  }

  async function removeImage(image: BlogImage): Promise<void> {
    const question = usedImages.has(image.file)
      ? 'Bild löschen? Es wird auch aus dem Text entfernt.'
      : 'Bild löschen?';
    const name = `Bild ${images.findIndex((item) => item.file === image.file) + 1}${image.alt ? ` „${image.alt}“` : ''}`;
    if (!postId || !(await confirmAction({ title: `${name} löschen?`, message: question }))) return;
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
      editor?.removeImage(image.file);
      notify(
        wasUsed
          ? 'Bild gelöscht. Bitte den Beitrag speichern, damit es auch im Text fehlt.'
          : 'Bild gelöscht.'
      );
    } catch (error: unknown) {
      handleError(
        error,
        'Das Bild wurde nicht gelöscht. Prüfe deine Internetverbindung und tippe noch einmal auf „Löschen“.'
      );
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
    notify('Bild in den Text eingefügt. Zum Übernehmen den Beitrag speichern.');
  }
</script>

<header class="ui-pagehead mb-8 border-b border-neutral-200 pb-6 md:pb-8">
  <div class="prose max-w-3xl">
    <h1
      class="ui-h ui-h--section underline-accent mb-8 font-serif text-2xl font-semibold text-brand-900 md:text-3xl"
    >
      {postId ? 'Beitrag bearbeiten' : 'Neuer Beitrag'}
    </h1>
  </div>
</header>

{#if loadError}
  <div role="alert" class="border-l-2 border-danger py-1 pl-4">
    <p class="text-sm text-neutral-700"><MessageText text={loadError} /></p>
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
      <p data-testid="blog-status">
        <StatusLabel
          label={published ? 'Veröffentlicht' : postId ? 'Entwurf' : 'Noch nicht gespeichert'}
          tone={published ? 'success' : 'neutral'}
          dot
        />
      </p>
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

      <div class="max-w-sm">
        <FormField
          id="blog-date"
          label="Datum"
          info="Bestimmt die Reihenfolge im Blog, z. B. der Tag der Aktion."
          error={errors.date}
        >
          {#snippet children(attrs)}
            <input {...attrs} type="date" class="form-input" bind:value={form!.date} />
          {/snippet}
        </FormField>
      </div>

      <FormField id="blog-content" label="Text" labelAs="span" error={errors.content}>
        {#snippet children(attrs)}
          <TextEditor
            bind:this={editor}
            bind:value={form!.content}
            format="html"
            id={attrs.id}
            labelledBy="blog-content-label"
            describedBy={attrs['aria-describedby']}
            invalid={!!attrs['aria-invalid']}
            features={{ headings: [2, 3], links: true, images: true }}
            sanitize={toCanonicalBlogHtml}
            toDisplay={(html) => (postId ? toEditorHtml(html, postId, images) : html)}
          />
        {/snippet}
      </FormField>

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
          {busy
            ? 'Wird gespeichert …'
            : published
              ? 'Änderungen speichern'
              : postId
                ? 'Als Entwurf speichern'
                : 'Als Entwurf anlegen'}
        </ActionButton>
        <ActionButton
          variant="secondary"
          type="button"
          disabled={busy || imageBusy !== null}
          onclick={changePublication}
        >
          {published ? 'Veröffentlichung zurücknehmen' : 'Veröffentlichen'}
        </ActionButton>
        {#if dirty}
          <span class="text-sm text-neutral-700">Ungespeicherte Änderungen</span>
        {/if}
        <span class="flex-1"></span>
        {#if postId && published}
          <a href={getBlogPostUrl(postId)} class="btn-secondary" target="_blank" rel="noopener">
            Auf der Website ansehen
          </a>
        {/if}
        {#if postId}
          <ActionButton
            variant="danger"
            type="button"
            disabled={busy || imageBusy !== null}
            onclick={async () => {
              if (
                await confirmAction({
                  title: `Beitrag „${form?.title.trim() || 'Ohne Titel'}“ löschen?`,
                  message: 'Beitrag mit allen Bildern löschen?',
                })
              )
                await remove();
            }}
          >
            Löschen
          </ActionButton>
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
        <p class="text-sm text-neutral-700">Bilder kannst du nach dem Anlegen hinzufügen.</p>
      {:else}
        <p class="text-xs text-neutral-700">Bilder werden sofort gespeichert.</p>
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
