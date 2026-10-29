import { useId, useRef, useState } from "react";
import {
  Download,
  CircleAlert,
  CircleCheck,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Grid2X2,
  Info,
  List,
  LoaderCircle,
  MoreVertical,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useGarage, type Doc } from "./store";
import { translations } from "./i18n";
import DocumentPreviewDialog from "./DocumentPreviewDialog";
import type { PreviewTarget } from "./DocumentPreview";

function FileIcon({ name, size = 22 }: { name: string; size?: number }) {
  const extension = name.split(".").pop()?.toLowerCase();
  const spreadsheet = extension === "xlsx" || extension === "csv";
  const Icon = spreadsheet ? FileSpreadsheet : FileText;
  return (
    <span
      className={`document-symbol ${spreadsheet ? "spreadsheet" : extension === "pdf" ? "pdf" : ""}`}
    >
      <Icon size={size} strokeWidth={1.5} />
    </span>
  );
}

function DocumentStatus({ doc, label }: { doc: Doc; label: string }) {
  const tooltipId = useId();
  const state =
    doc.status === "ready"
      ? "ready"
      : doc.status === "failed"
        ? "failed"
        : "indexing";
  const Icon =
    state === "ready"
      ? CircleCheck
      : state === "failed"
        ? CircleAlert
        : LoaderCircle;
  return (
    <span
      className={`doc-status-indicator ${state}`}
      tabIndex={0}
      role="img"
      aria-label={`${doc.name}: ${label}`}
      aria-describedby={tooltipId}
    >
      <Icon
        size={16}
        className={state === "indexing" ? "spin" : undefined}
        aria-hidden="true"
      />
      <span className="doc-status-tooltip" role="tooltip" id={tooltipId}>
        {label}
      </span>
    </span>
  );
}

export default function DocumentsView({
  configured,
  uploading,
  upload,
  removeDoc,
}: {
  configured: boolean;
  uploading: boolean;
  upload: (files: FileList | null) => Promise<void>;
  removeDoc: (doc: Doc) => Promise<void>;
}) {
  const s = useGarage(),
    t = translations[s.language];
  const [layout, setLayout] = useState<"list" | "grid">("list"),
    [query, setQuery] = useState(""),
    [detailsId, setDetailsId] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const openPreview = (doc: Doc) =>
    setPreview({ documentId: doc.id, name: doc.name });
  const docs = s.docs.filter((d) =>
    d.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const details = s.docs.find((d) => d.id === detailsId);
  async function handleUpload(files: FileList | null) {
    await upload(files);
    if (file.current) file.current.value = "";
  }
  const status = (doc: Doc) =>
    doc.status === "ready"
      ? t.readyDoc
      : doc.status === "failed"
        ? t.failed
        : t.indexing;
  return (
    <section className="workspace-view" aria-label={t.documents}>
      <div className="view-toolbar">
        <h1>
          {t.documents}
          <span className="view-count">{s.docs.length}</span>
        </h1>
        <button
          className="primary"
          disabled={!configured || uploading}
          onClick={() => file.current?.click()}
        >
          {uploading ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Upload size={16} />
          )}
          {uploading ? t.uploadBusy : t.upload}
        </button>
        <input
          type="file"
          aria-label={t.upload}
          ref={file}
          hidden
          tabIndex={-1}
          multiple
          disabled={!configured || uploading}
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv"
          onChange={(event) => void handleUpload(event.target.files)}
        />
      </div>
      <div className="view-controls">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label={t.searchDocs}
            placeholder={t.searchDocs}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="view-toggle" role="group" aria-label={t.documents}>
          <button
            aria-label={t.listView}
            title={t.listView}
            aria-pressed={layout === "list"}
            onClick={() => setLayout("list")}
          >
            <List size={18} />
          </button>
          <button
            aria-label={t.gridView}
            title={t.gridView}
            aria-pressed={layout === "grid"}
            onClick={() => setLayout("grid")}
          >
            <Grid2X2 size={17} />
          </button>
        </div>
      </div>
      {!configured && (
        <div className="view-notice">
          <Info size={16} />
          <div>
            <strong>{t.apiMissing}</strong>
            <p>{t.apiMissingSub}</p>
          </div>
        </div>
      )}
      <div className="workspace-body">
        <div className="workspace-content">
          {!docs.length ? (
            <div className="empty-view">
              <FolderOpen size={34} strokeWidth={1.3} />
              <h2>{query ? t.noResults : t.emptyDocs}</h2>
              {!query && (
                <>
                  <p>{t.emptyDocsSub}</p>
                  <small>{t.uploadHint}</small>
                </>
              )}
            </div>
          ) : layout === "list" ? (
            <div className="files-list" role="table" aria-label={t.documents}>
              <div className="files-list-header" role="row">
                <span role="columnheader">{t.fileName}</span>
                <span role="columnheader" className="sr-only">
                  {t.status}
                </span>
                <span role="columnheader" className="sr-only">
                  {t.details}
                </span>
              </div>
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  role="row"
                  className={`file-row ${detailsId === doc.id ? "is-selected" : ""}`}
                >
                  <div role="cell" className="file-name-cell">
                    <button
                      className="file-name"
                      onClick={() => openPreview(doc)}
                    >
                      <FileIcon name={doc.name} />
                      <span>{doc.name}</span>
                    </button>
                  </div>
                  <div role="cell" className="file-status-cell">
                    <DocumentStatus doc={doc} label={status(doc)} />
                  </div>
                  <div role="cell">
                    <button
                      className="icon-button"
                      aria-label={`${t.details}: ${doc.name}`}
                      aria-pressed={doc.id === detailsId}
                      onClick={() =>
                        setDetailsId(doc.id === detailsId ? null : doc.id)
                      }
                    >
                      <MoreVertical size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="files-grid">
              {docs.map((doc) => (
                <article
                  key={doc.id}
                  className={`file-card ${detailsId === doc.id ? "is-selected" : ""}`}
                >
                  <button
                    className="file-preview"
                    aria-label={`${t.preview}: ${doc.name}`}
                    onClick={() => openPreview(doc)}
                  >
                    <FileIcon name={doc.name} size={58} />
                  </button>
                  <div className="file-card-bottom">
                    <button
                      className="file-card-name"
                      onClick={() => openPreview(doc)}
                    >
                      <FileIcon name={doc.name} size={17} />
                      <span>{doc.name}</span>
                    </button>
                    <DocumentStatus doc={doc} label={status(doc)} />
                    <button
                      className="icon-button"
                      aria-label={`${t.details}: ${doc.name}`}
                      aria-pressed={doc.id === detailsId}
                      onClick={() =>
                        setDetailsId(doc.id === detailsId ? null : doc.id)
                      }
                    >
                      <MoreVertical size={18} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        {details && (
          <aside className="detail-panel" aria-label={t.details}>
            <div className="detail-heading">
              <h2>{t.details}</h2>
              <button
                className="icon-button"
                aria-label={t.close}
                onClick={() => setDetailsId(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="detail-preview">
              <FileIcon name={details.name} size={62} />
            </div>
            <h3>{details.name}</h3>
            <dl>
              <div>
                <dt>{t.fileType}</dt>
                <dd>{details.name.split(".").pop()?.toUpperCase() || "—"}</dd>
              </div>
              <div>
                <dt>{t.fileSize}</dt>
                <dd>
                  {new Intl.NumberFormat(s.language, {
                    maximumFractionDigits: 1,
                  }).format(
                    details.size < 1024 ? details.size : details.size / 1024,
                  )}{" "}
                  {details.size < 1024 ? "B" : "KB"}
                </dd>
              </div>
              <div>
                <dt>{t.uploadedAt}</dt>
                <dd>
                  {details.created_at
                    ? new Intl.DateTimeFormat(s.language, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(details.created_at))
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t.status}</dt>
                <dd className={`document-status ${details.status}`}>
                  {details.status === "indexing" && (
                    <LoaderCircle size={13} className="spin" />
                  )}
                  {status(details)}
                </dd>
              </div>
              <div>
                <dt>{t.chunks}</dt>
                <dd>{details.chunk_count}</dd>
              </div>
            </dl>
            {details.error && (
              <p className="doc-error" role="alert">
                {details.error}
              </p>
            )}
            <a
              className="secondary full-width"
              href={`/api/documents/${details.id}/download`}
            >
              <Download size={15} />
              {t.download}
            </a>
            <button
              className="danger-link"
              disabled={details.status === "indexing"}
              onClick={() => void removeDoc(details)}
            >
              <Trash2 size={15} />
              {t.delete}
            </button>
          </aside>
        )}
      </div>
      {preview && (
        <DocumentPreviewDialog
          target={preview}
          close={() => setPreview(null)}
        />
      )}
    </section>
  );
}
