import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  LoaderCircle,
} from "lucide-react";
import "react-pdf/dist/Page/TextLayer.css";
import { citationBoxes, type HighlightBox } from "./citationHighlight";
import { HighlightLayer } from "./DocumentPreview";
import { useGarage } from "./store";
import { translations } from "./i18n";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
const options = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  isEvalSupported: false,
};

export default function PdfView({
  documentId,
  initialPage,
  pageCount,
  excerpt,
  reportMatch,
}: {
  documentId: string;
  initialPage: number;
  pageCount: number;
  excerpt: string;
  reportMatch: (value: "found" | "partial" | "missing") => void;
}) {
  const language = useGarage((s) => s.language),
    t = translations[language];
  const [page, setPage] = useState(initialPage),
    [pages, setPages] = useState(pageCount),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(500),
    [textVersion, setTextVersion] = useState(0),
    [error, setError] = useState(false);
  const [boxes, setBoxes] = useState<HighlightBox[]>([]),
    [active, setActive] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null);
  // React-PDF restarts its text layer when this callback changes. Keep it stable
  // so measuring the citation does not clear and rebuild the text layer.
  const handleTextLayerSuccess = useCallback(
    () => setTextVersion((value) => value + 1),
    [],
  );
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setWidth(Math.max(180, Math.min(1000, element.clientWidth - 40))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setBoxes([]);
    setActive(false);
    if (!excerpt || page !== initialPage || !root.current || !textVersion)
      return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      if (!root.current) return;
      const result = citationBoxes(root.current, excerpt);
      setBoxes(result.boxes);
      reportMatch(
        result.boxes.length
          ? result.partial
            ? "partial"
            : "found"
          : "missing",
      );
      if (result.boxes.length) {
        setActive(true);
        viewport.current?.scrollTo({
          top: Math.max(0, result.boxes[0].top - 100),
          left: Math.max(0, result.boxes[0].left - 100),
          behavior: "smooth",
        });
        timer = setTimeout(() => setActive(false), 5000);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [textVersion, excerpt, page, initialPage, width, zoom, reportMatch]);
  return (
    <>
      <div className="pdf-toolbar">
        <div>
          <button
            className="icon-button"
            aria-label={t.previousPage}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <label>
            {t.page}
            <input
              type="number"
              aria-label={t.page}
              min={1}
              max={pages}
              value={page}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (value >= 1 && value <= pages) setPage(value);
              }}
            />
          </label>
          <span>/ {pages}</span>
          <button
            className="icon-button"
            aria-label={t.nextPage}
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <div>
          <button
            className="icon-button"
            aria-label={t.zoomOut}
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            <Minus size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            aria-label={t.zoomIn}
            disabled={zoom >= 2}
            onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="reader-scroll pdf-scroll" ref={viewport}>
        <Document
          file={`/api/documents/${documentId}/content`}
          options={options}
          suspense={false}
          onLoadSuccess={(pdf) => setPages(pdf.numPages)}
          onLoadError={() => setError(true)}
          loading={
            <div className="center-state">
              <LoaderCircle className="spin" />
            </div>
          }
          error={<p className="reader-error">{t.previewFailed}</p>}
        >
          <div className="pdf-page-root" ref={root}>
            <Page
              key={page}
              pageNumber={page}
              width={width * zoom}
              renderTextLayer
              renderAnnotationLayer={false}
              suspense={false}
              devicePixelRatio={Math.min(window.devicePixelRatio || 1, 1.5)}
              onRenderTextLayerSuccess={handleTextLayerSuccess}
              onRenderError={() => setError(true)}
              loading={
                <div className="center-state">
                  <LoaderCircle className="spin" />
                </div>
              }
            />
            <HighlightLayer boxes={boxes} active={active} />
          </div>
        </Document>
        {error && <p className="reader-error">{t.previewFailed}</p>}
      </div>
    </>
  );
}
