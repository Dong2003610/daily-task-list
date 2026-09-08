import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  busy = false,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    // The native modal dialog supplies focus containment and an inert background.
    if (!dialog.open) dialog.showModal();
    dialog
      .querySelector<HTMLElement>("[data-autofocus]:not(:disabled)")
      ?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={["modal", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      aria-modal="true"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="button secondary modal-close"
          aria-label="关闭"
          disabled={busy}
          onClick={() => {
            if (!busy) onClose();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export default Modal;
