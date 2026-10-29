import { useEffect, useRef } from "react";
import DocumentPreview, { type PreviewTarget } from "./DocumentPreview";

export default function DocumentPreviewDialog({
  target,
  close,
}: {
  target: PreviewTarget;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current,
      opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="document-preview-dialog"
      aria-label={target.name}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <DocumentPreview target={target} close={close} />
    </dialog>
  );
}
