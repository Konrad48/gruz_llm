import { useEffect, useId, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import type { Message } from "./store";
import { useGarage } from "./store";
import { translations } from "./i18n";
import ExecutionDetails from "./ExecutionDetails";
import DocumentPreview, { type PreviewTarget } from "./DocumentPreview";
import type { Source } from "./store";

export default function MessageInsightsDrawer({
  message,
  close,
}: {
  message: Message;
  close: () => void;
}) {
  const language = useGarage((s) => s.language),
    t = translations[language];
  const dialog = useRef<HTMLDialogElement>(null),
    tabs = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"sources" | "execution">("sources");
  const id = useId();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const sourceTrigger = useRef<HTMLButtonElement | null>(null);
  const sourceGroups = new Map<string, { name: string; sources: Source[] }>();
  for (const source of message.sources) {
    let group = sourceGroups.get(source.document_id);
    if (!group) {
      group = { name: source.name, sources: [] };
      sourceGroups.set(source.document_id, group);
    }
    group.sources.push(source);
  }
  function openSource(source: Source, trigger: HTMLButtonElement) {
    sourceTrigger.current = trigger;
    setPreview({
      documentId: source.document_id,
      name: source.name,
      source,
      nonce: Date.now(),
    });
  }
  function closePreview() {
    setPreview(null);
    requestAnimationFrame(() =>
      sourceTrigger.current?.focus({ preventScroll: true }),
    );
  }
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
      className={`insights-drawer ${preview ? "has-preview" : ""}`}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (preview) closePreview();
        else close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="source-workspace">
        {preview && (
          <div className="source-document-preview">
            <DocumentPreview
              key={`${preview.documentId}-${preview.source?.id}-${preview.nonce}`}
              target={preview}
              close={closePreview}
            />
          </div>
        )}
        <div className="insights-drawer-inner">
          <header className="insights-drawer-heading">
            <h2 id={`${id}-title`}>
              {t.sources} <span>{message.sources.length}</span>
            </h2>
            <button
              className="icon-button"
              aria-label={t.close}
              onClick={close}
              autoFocus
            >
              <X size={19} />
            </button>
          </header>
          <div
            ref={tabs}
            className="insights-tabs"
            role="tablist"
            aria-label={t.messageDetails}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "sources"
                  : event.key === "End"
                    ? "execution"
                    : tab === "sources"
                      ? "execution"
                      : "sources";
              setTab(next);
              tabs.current
                ?.querySelector<HTMLButtonElement>(
                  `#${CSS.escape(`${id}-${next}-tab`)}`,
                )
                ?.focus();
            }}
          >
            <button
              role="tab"
              id={`${id}-sources-tab`}
              aria-controls={`${id}-sources-panel`}
              aria-selected={tab === "sources"}
              tabIndex={tab === "sources" ? 0 : -1}
              onClick={() => setTab("sources")}
            >
              {t.sources}
              <span>{message.sources.length}</span>
            </button>
            <button
              role="tab"
              id={`${id}-execution-tab`}
              aria-controls={`${id}-execution-panel`}
              aria-selected={tab === "execution"}
              tabIndex={tab === "execution" ? 0 : -1}
              onClick={() => setTab("execution")}
            >
              {t.executionTab}
            </button>
          </div>
          {(["sources", "execution"] as const).map((panel) => (
            <div
              className="insights-panel"
              role="tabpanel"
              id={`${id}-${panel}-panel`}
              aria-labelledby={`${id}-${panel}-tab`}
              tabIndex={0}
              key={panel}
              hidden={tab !== panel}
            >
              {panel === "sources" ? (
                message.sources.length ? (
                  <ul className="drawer-sources">
                    {Array.from(sourceGroups, ([documentId, group]) => (
                      <li key={documentId} className="drawer-source">
                        <div className="drawer-source-heading">
                          <FileText size={16} />
                          <h3>{group.name}</h3>
                        </div>
                        <ul className="source-location-list">
                          {group.sources.map((source) => (
                            <li key={source.id}>
                              {source.kind === "web" &&
                              source.url &&
                              /^https?:\/\//i.test(source.url) ? (
                                <>
                                  <a
                                    className="source-location-link"
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {source.url}
                                  </a>
                                  <details>
                                    <summary>{t.webExcerpt}</summary>
                                    <p>{source.excerpt}</p>
                                    <small>{source.retrieved_at}</small>
                                  </details>
                                </>
                              ) : (
                                <button
                                  className="source-location-link"
                                  aria-pressed={
                                    preview?.source?.id === source.id
                                  }
                                  title={`${group.name} · ${source.location}`}
                                  onClick={(event) =>
                                    openSource(source, event.currentTarget)
                                  }
                                >
                                  {source.location || t.preview}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="insights-empty">{t.noSources}</p>
                )
              ) : (
                <ExecutionDetails
                  events={message.execution || []}
                  running={message.status === "generating"}
                  failed={message.status === "failed"}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
