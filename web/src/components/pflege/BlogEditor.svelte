<script lang="ts">
  import BlogEditorImages from './BlogEditorImages.svelte';
  import BlogWorkflowControls from './BlogWorkflowControls.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { requestBlogPost } from '../../lib/blogPostRequest';
  import { blogPflege } from '../../lib/pflegeStore.svelte';
  import { todayIso } from '../../lib/format';
  import {
    getBlogPostUrl,
    getStaffBlogImageUrl,
    getUsedImages,
    toCanonicalBlogHtml,
    toEditorHtml,
  } from '../../lib/blog';
  import type { BlogImage } from '../../lib/blogTypes';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import FormField from './FormField.svelte';
  import TextEditor from '../ui/TextEditor.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import { confirmAction } from '../../lib/confirm';

  import type { BlogWorkflow } from '../../../../api/lib/blog-workflow-model';
  interface Form {
    title: string;
    date: string;
    published: boolean;
    content: string;
  }

  const LIST_URL = '/leitendenbereich/blog';

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
  let workflowBusy = $state(false);
  let feedback = $state('');
  let workflow = $state<BlogWorkflow>({ state: 'draft' });
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

    return guardUnsavedChanges(
      () => dirty || busy || workflowBusy || !!feedback.trim() || imageBusy !== null
    );
  });

  function setForm(value: Form): void {
    published = value.published;
    form = value;
    saved = JSON.stringify(value);
  }

  async function load(id: string): Promise<void> {
    loadError = null;
    conflict = false;
    try {
      const post = await requestBlogPost(id);
      workflow = post.workflow ?? { state: post.published ? 'published' : 'draft' };
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

  async function save(): Promise<void> {
    const targetPublished = false;
    if (!form || busy || workflowBusy || imageBusy !== null) return;
    if (
      published &&
      !(await confirmAction({
        title: 'Veröffentlichten Beitrag als Entwurf speichern?',
        message: 'Der Beitrag wird von der Website genommen und muss erneut geprüft werden.',
        confirmLabel: 'Als Entwurf speichern',
      }))
    )
      return;
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
      // The list of posts asks again when it is shown next
      blogPflege.invalidate();
      workflow = { state: 'draft' };
      notify('Als Entwurf gespeichert.');
    } catch (error: unknown) {
      handleError(error);
    } finally {
      busy = false;
    }
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
      // Gone from the list at once; the list asks again when it is shown
      const deletedId = postId;
      if (blogPflege.state.data) {
        blogPflege.state.data = blogPflege.state.data.filter((post) => post.id !== deletedId);
      }
      blogPflege.invalidate();
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
      <div class="space-y-5" inert={busy || workflowBusy}>
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
        <ActionButton
          variant="primary"
          type="submit"
          disabled={busy || workflowBusy || imageBusy !== null}
        >
          {busy
            ? 'Wird gespeichert …'
            : published
              ? 'Als Entwurf speichern'
              : postId
                ? 'Als Entwurf speichern'
                : 'Als Entwurf anlegen'}
        </ActionButton>
        {#if postId}<BlogWorkflowControls
            id={postId}
            {etag}
            disabled={dirty || busy || imageBusy !== null}
            {workflow}
            bind:busy={workflowBusy}
            bind:feedback
            onchanged={(result, text) => {
              etag = result.etag;
              workflow = result.workflow;
              published = workflow.state === 'published';
              form!.published = published;
              saved = JSON.stringify(form);
              notify(text);
            }}
          />{/if}
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
            disabled={busy || workflowBusy || imageBusy !== null}
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

    <div inert={busy || workflowBusy}>
      <BlogEditorImages
        {published}
        onchanged={() => {
          published = false;
          workflow = { state: 'draft' };
        }}
        {postId}
        bind:etag
        bind:images
        bind:imageBusy
        {usedImages}
        {notify}
        {handleError}
        oninsert={(image) => {
          if (postId)
            editor?.insertImage({
              'data-bild': image.file,
              src: getStaffBlogImageUrl(postId, image),
              alt: image.alt,
            });
        }}
        onremove={(file) => editor?.removeImage(file)}
      />
    </div>
  </form>
{/if}
