<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { sendApi } from '../../lib/api';
  import { blogPflege } from '../../lib/pflegeStore.svelte';
  import { getStaffBlogImageUrl, toScaledJpeg } from '../../lib/blog';
  import { confirmAction } from '../../lib/confirm';
  import type { BlogImage } from '../../lib/blogTypes';
  interface ImagesResponse {
    etag: string;
    images: BlogImage[];
  }
  interface Props {
    published: boolean;
    onchanged: () => void;
    postId: string | null;
    etag: string;
    images: BlogImage[];
    imageBusy: string | null;
    usedImages: Set<string>;
    oninsert: (image: BlogImage) => void;
    onremove: (file: string) => void;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
    handleError: (error: unknown, fallback?: string) => void;
  }
  let {
    published,
    onchanged,
    postId,
    etag = $bindable(),
    images = $bindable(),
    imageBusy = $bindable(),
    usedImages,
    oninsert,
    onremove,
    notify,
    handleError,
  }: Props = $props();
  const IMAGE_SIZE = 1600;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const MAX_IMAGES = 30;
  function applyImages(result: ImagesResponse): void {
    onchanged();
    etag = result.etag;
    images = result.images;
    // The list shows the cover image
    blogPflege.invalidate();
  }

  async function allowChange(): Promise<boolean> {
    return (
      !published ||
      (await confirmAction({
        title: 'Veröffentlichten Beitrag als Entwurf ändern?',
        message: 'Der Beitrag wird von der Website genommen und muss erneut geprüft werden.',
        confirmLabel: 'Als Entwurf ändern',
      }))
    );
  }

  async function upload(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!postId || files.length === 0) return;
    if (!(await allowChange())) return;
    const id = postId;

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
    if (!(await allowChange())) return;
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
    if (!(await allowChange())) return;
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
      onremove(image.file);
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
    oninsert(image);
    notify('Bild in den Text eingefügt. Zum Übernehmen den Beitrag speichern.');
  }
</script>

<section
  aria-labelledby="blog-images-heading"
  class="space-y-4 border-t border-neutral-200 pt-5 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0"
>
  <div class="flex items-center justify-between gap-2">
    <h2 id="blog-images-heading" class="font-serif text-xl font-semibold text-brand-900">Bilder</h2>
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
