import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  LocateFixed,
  X,
} from "lucide-react";
import { api, useGarage, type Source } from "./store";
import { translations } from "./i18n";
import { citationBoxes, type HighlightBox } from "./citationHighlight";

const PdfView = lazy(() => import("./PdfView"));
export interface PreviewTarget {
  documentId: string;
  name: string;
  source?: Source;
  nonce?: number;
}
export interface PreviewData {
  name: string;
  kind: "pdf" | "word" | "spreadsheet";
  excerpt: string;
  location: string;
  page?: number;
  pages?: number;
  blocks?: {
    kind: "paragraph" | "table";
    text?: string;
    runs?: { text: string; bold?: boolean; italic?: boolean }[];
    level?: number;
    list?: boolean;
    rows?: string[][];
  }[];
  sheets?: { name: string; rows: number; columns: number }[];
  sheet?: string;
  row_start?: number;
  column_start?: number;
  rows?: string[][];
  target_row?: number | null;
}
export function HighlightLayer({
  boxes,
  active,
}: {
  boxes: HighlightBox[];
  active: boolean;
}) {
  return active ? (
    <div
      className="citation-highlight-layer"
      aria-hidden="true"
      data-no-highlight
    >
      {boxes.map((box, index) => (
        <span key={index} className="citation-highlight" style={box} />
      ))}
    </div>
  ) : null;
}
function columnName(index: number) {
  let label = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}

export default function DocumentPreview({
  target,
  close,
}: {
  target: PreviewTarget;
  close: () => void;
}) {
  const language = useGarage((s) => s.language),
    t = translations[language];
  const [data, setData] = useState<PreviewData | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<string | undefined>(),
    [row, setRow] = useState<number | undefined>(),
    [column, setColumn] = useState(1),
    [jump, setJump] = useState(0);
  const [match, setMatch] = useState<"found" | "partial" | "missing" | null>(
      null,
    ),
    [boxes, setBoxes] = useState<HighlightBox[]>([]),
    [active, setActive] = useState(false),
    [width, setWidth] = useState(0);
  const content = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setMatch(null);
    setBoxes([]);
    const params = new URLSearchParams();
    if (target.source) params.set("source_id", target.source.id);
    if (sheet) params.set("sheet", sheet);
    if (row) params.set("row_start", String(row));
    if (column !== 1) params.set("column_start", String(column));
    api<PreviewData>(`/documents/${target.documentId}/preview?${params}`)
      .then((value) => {
        if (live) setData(value);
      })
      .catch((e) => {
        if (live) setError(e.message === "NETWORK" ? t.connection : e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    target.documentId,
    target.source?.id,
    target.nonce,
    sheet,
    row,
    column,
    jump,
  ]);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [data, loading]);
  useEffect(() => {
    if (
      loading ||
      !data ||
      data.kind === "pdf" ||
      !target.source ||
      !content.current
    )
      return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const root = content.current;
      if (!root) return;
      const result = citationBoxes(root, data.excerpt);
      setBoxes(result.boxes);
      setMatch(
        result.boxes.length
          ? result.partial
            ? "partial"
            : "found"
          : "missing",
      );
      if (result.boxes.length) {
        setActive(true);
        const first = result.boxes[0];
        scroll.current?.scrollTo({
          top: Math.max(0, first.top - 100),
          left: Math.max(0, first.left - 100),
          behavior: "smooth",
        });
        timer = setTimeout(() => setActive(false), 5000);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      setActive(false);
    };
  }, [data, loading, target.source, width, jump]);
  function jumpToSource() {
    setSheet(undefined);
    setRow(undefined);
    setColumn(1);
    setJump((value) => value + 1);
  }
  const selected = data?.sheets?.find((item) => item.name === data.sheet);
  const firstRow = data?.row_start || 1,
    firstColumn = data?.column_start || 1;
  return (
    <section
      className="document-reader"
      aria-label={`${t.preview}: ${target.name}`}
    >
      <header className="reader-header">
        <FileText size={17} />
        <h2 title={target.name}>{target.name}</h2>
        <a
          className="icon-button"
          href={`/api/documents/${target.documentId}/download`}
          aria-label={t.download}
          title={t.download}
        >
          <Download size={17} />
        </a>
        <button
          className="icon-button"
          aria-label={t.closePreview}
          title={t.closePreview}
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      {target.source && (
        <div className="reader-citation-bar">
          <button onClick={jumpToSource}>
            <LocateFixed size={14} />
            {t.jumpToCitation}
          </button>
          {match && (
            <span role="status">
              {match === "missing"
                ? t.citationNotFound
                : match === "partial"
                  ? t.citationPartial
                  : t.citationFound}
            </span>
          )}
        </div>
      )}
      {loading ? (
        <div className="center-state">
          <LoaderCircle className="spin" size={23} />
          <span>{t.loading}</span>
        </div>
      ) : error ? (
        <div className="reader-error" role="alert">
          <p>{error}</p>
          <a
            className="secondary"
            href={`/api/documents/${target.documentId}/download`}
          >
            {t.download}
          </a>
        </div>
      ) : data?.kind === "pdf" ? (
        <Suspense
          fallback={
            <div className="center-state">
              <LoaderCircle className="spin" />
            </div>
          }
        >
          <PdfView
            key={`${target.documentId}-${jump}`}
            documentId={target.documentId}
            initialPage={data.page || 1}
            pageCount={data.pages || 1}
            excerpt={data.excerpt}
            reportMatch={setMatch}
          />
        </Suspense>
      ) : (
        <>
          {data?.kind === "spreadsheet" && (
            <div className="sheet-tabs" role="tablist" aria-label={t.sheets}>
              {data.sheets?.map((item) => (
                <button
                  role="tab"
                  aria-selected={item.name === data.sheet}
                  key={item.name}
                  onClick={() => {
                    setSheet(item.name);
                    setRow(1);
                    setColumn(1);
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
          <div
            className={`reader-scroll ${data?.kind === "word" ? "word-scroll" : "sheet-scroll"}`}
            ref={scroll}
          >
            <div
              className={`reader-highlight-root ${data?.kind === "word" ? "word-page" : "sheet-page"}`}
              ref={content}
            >
              {data?.kind === "word" ? (
                data.blocks?.map((block, index) =>
                  block.kind === "table" ? (
                    <div className="word-table-wrap" key={index}>
                      <table>
                        <tbody>
                          {block.rows?.map((cells, r) => (
                            <tr key={r}>
                              {cells.map((value, c) => (
                                <td key={c}>{value}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : block.level ? (
                    <div
                      className={`word-heading level-${block.level}`}
                      role="heading"
                      aria-level={block.level}
                      key={index}
                    >
                      {block.text}
                    </div>
                  ) : (
                    <p
                      className={block.list ? "word-list-item" : ""}
                      key={index}
                    >
                      {block.runs?.map((run, r) => (
                        <span
                          key={r}
                          style={{
                            fontWeight: run.bold ? 600 : undefined,
                            fontStyle: run.italic ? "italic" : undefined,
                          }}
                        >
                          {run.text}
                        </span>
                      ))}
                      {!block.text && <br />}
                    </p>
                  ),
                )
              ) : (
                <table className="sheet-table">
                  <thead data-no-highlight>
                    <tr>
                      <th aria-label={t.row} />
                      {Array.from(
                        {
                          length: Math.max(
                            1,
                            ...(data?.rows || []).map((cells) => cells.length),
                          ),
                        },
                        (_, index) => (
                          <th key={index}>{columnName(firstColumn + index)}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data?.rows?.map((cells, r) => (
                      <tr key={r}>
                        <th data-no-highlight>{firstRow + r}</th>
                        {cells.map((value, c) => (
                          <td key={c}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <HighlightLayer boxes={boxes} active={active} />
            </div>
          </div>
          {data?.kind === "spreadsheet" && (
            <footer className="sheet-navigation">
              <div>
                <button
                  className="icon-button"
                  aria-label={t.previousRows}
                  disabled={firstRow <= 1}
                  onClick={() => setRow(Math.max(1, firstRow - 100))}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {t.rows} {firstRow}–
                  {Math.min(
                    firstRow + (data.rows?.length || 1) - 1,
                    selected?.rows || 1,
                  )}{" "}
                  / {selected?.rows || 0}
                </span>
                <button
                  className="icon-button"
                  aria-label={t.nextRows}
                  disabled={firstRow + 100 > (selected?.rows || 0)}
                  onClick={() => setRow(firstRow + 100)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div>
                <button
                  className="icon-button"
                  aria-label={t.previousColumns}
                  disabled={firstColumn <= 1}
                  onClick={() => {
                    setRow(firstRow);
                    setColumn(Math.max(1, firstColumn - 30));
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {columnName(firstColumn)}–
                  {columnName(
                    Math.min(firstColumn + 29, selected?.columns || 1),
                  )}
                </span>
                <button
                  className="icon-button"
                  aria-label={t.nextColumns}
                  disabled={firstColumn + 30 > (selected?.columns || 0)}
                  onClick={() => {
                    setRow(firstRow);
                    setColumn(firstColumn + 30);
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </footer>
          )}
        </>
      )}
    </section>
  );
}
