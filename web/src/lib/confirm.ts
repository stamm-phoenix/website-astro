import { mount, tick, unmount } from 'svelte';
import ConfirmPrompt from '../components/ui/ConfirmPrompt.svelte';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the button that confirms, shown in the danger style. */
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Asks in the app's own dialog instead of `window.confirm` and resolves with the answer.
 * Closing the dialog counts as cancelling.
 */
export function confirmAction({
  title,
  message,
  confirmLabel = 'Löschen',
  cancelLabel = 'Abbrechen',
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const target = document.createElement('div');
    document.body.append(target);
    const prompt = mount(ConfirmPrompt, {
      target,
      props: {
        title,
        message,
        confirmLabel,
        cancelLabel,
        onresult: (confirmed: boolean) => {
          resolve(confirmed);
          // Let the dialog close and return the focus before it is removed.
          void tick().then(() => {
            void unmount(prompt);
            target.remove();
          });
        },
      },
    });
  });
}
