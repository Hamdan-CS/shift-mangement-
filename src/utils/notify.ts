import { toast, type ExternalToast } from 'sonner';

/** App messages. Pass `action` for an Undo button (Amplo / Veyla toast). */
export const notify = {
  success(message: string, opts?: ExternalToast) { toast.success(message, opts); },
  info(message: string, opts?: ExternalToast) { toast.info(message, opts); },
  /** errors are always toasts, so they can't be missed */
  error(message: string, opts?: ExternalToast) { toast.error(message, opts); },
  /** "Done · Undo" toast used after approve / decline / schedule edit. */
  undoable(message: string, onUndo: () => void, opts?: ExternalToast) {
    toast.success(message, { ...opts, action: { label: 'Undo', onClick: onUndo } });
  },
};
