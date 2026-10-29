import {
  Activity,
  Check,
  CircleAlert,
  LoaderCircle,
  Search,
  Wrench,
} from "lucide-react";
import type { ExecutionEvent } from "./store";
import { useGarage } from "./store";
import { translations } from "./i18n";

function activityLabel(
  event: ExecutionEvent | undefined,
  language: "en" | "pl",
) {
  const t = translations[language];
  const labels: Record<string, string> = {
    run_started: t.executionStarted,
    search_started: t.searchingDocuments,
    embedding_started: t.embeddingQuery,
    embedding_completed: t.queryEmbedded,
    search_completed: t.searchFinished,
    model_started: t.generatingResponse,
    model_completed: t.modelResponded,
    tool_started: t.callingTool,
    tool_completed: t.toolFinished,
    run_completed: t.executionCompleted,
    run_failed: t.executionFailed,
  };
  return event ? labels[event.kind] || event.kind : t.waitingForAgent;
}

export function LiveExecutionActivity({
  events,
  connectionLost,
}: {
  events: ExecutionEvent[];
  connectionLost: boolean;
}) {
  const language = useGarage((s) => s.language),
    t = translations[language];
  const latest = events.at(-1);
  const searching =
    latest?.kind.startsWith("search_") || latest?.kind.startsWith("embedding_");
  const reverse = [...events].reverse();
  const query = searching
    ? reverse.find((event) => event.data.query)?.data.query
    : undefined;
  const lastTool = reverse.find((event) => event.kind === "tool_started");
  const toolFinished =
    lastTool &&
    events.some(
      (event) =>
        event.kind === "tool_completed" &&
        event.data.call_id === lastTool.data.call_id,
    );
  const tool = !toolFinished ? lastTool?.data.tool : undefined;
  return (
    <div className="agent-activity" role="status">
      <LoaderCircle size={15} className="spin" />
      <div>
        <span>
          {connectionLost ? t.reconnecting : activityLabel(latest, language)}
        </span>
        {tool && <code>{tool}</code>}
        {query && <small title={query}>{query}</small>}
        {latest?.kind === "model_started" && <small>{latest.data.model}</small>}
      </div>
    </div>
  );
}

export default function ExecutionDetails({
  events,
  running = false,
  failed = false,
}: {
  events: ExecutionEvent[];
  running?: boolean;
  failed?: boolean;
}) {
  const language = useGarage((s) => s.language),
    t = translations[language];
  const last = events.at(-1);
  return (
    <section className="execution-content">
      {events.length > 0 && (
        <div className="execution-overview">
          <Activity size={14} />
          <span>
            {running
              ? activityLabel(last, language)
              : failed
                ? t.executionFailed
                : t.executionCompleted}
          </span>
          <span className="execution-duration">
            {last ? `${(last.elapsed_ms / 1000).toFixed(1)} s` : ""}
          </span>
        </div>
      )}
      <ol className="execution-timeline">
        {events.map((event, index) => {
          const current = running && index === events.length - 1;
          const Icon = current
            ? LoaderCircle
            : event.kind === "run_failed"
              ? CircleAlert
              : event.kind.startsWith("search_")
                ? Search
                : event.kind.startsWith("tool_")
                  ? Wrench
                  : Check;
          return (
            <li
              key={event.id}
              className={event.kind === "run_failed" ? "execution-error" : ""}
            >
              <div className="execution-marker">
                <Icon size={13} className={current ? "spin" : undefined} />
              </div>
              <div className="execution-event">
                <header>
                  <strong>{activityLabel(event, language)}</strong>
                  <time
                    title={new Date(event.timestamp).toLocaleString(language)}
                  >
                    +{(event.elapsed_ms / 1000).toFixed(1)} s
                  </time>
                </header>
                {event.data.model && <p>{event.data.model}</p>}
                {event.data.vehicle && <p>{event.data.vehicle}</p>}
                {event.data.tool && <code>{event.data.tool}</code>}
                {event.data.call_id && (
                  <p className="execution-call-id">
                    {t.toolCallId}: {event.data.call_id}
                  </p>
                )}
                {event.data.arguments && (
                  <pre>{JSON.stringify(event.data.arguments, null, 2)}</pre>
                )}
                {event.data.query && (
                  <blockquote>{event.data.query}</blockquote>
                )}
                {event.data.method && (
                  <p>
                    {event.data.method} · {t.resultLimit}: {event.data.limit}
                  </p>
                )}
                {event.data.dimensions !== undefined && (
                  <p>
                    {t.dimensions}: {event.data.dimensions}
                  </p>
                )}
                {event.data.count !== undefined && (
                  <p>
                    {t.searchResults}: {event.data.count}
                  </p>
                )}
                {event.data.request !== undefined && (
                  <p>
                    {t.modelCall}: {event.data.request}
                  </p>
                )}
                {event.data.requests !== undefined && (
                  <p>
                    {t.modelCalls}: {event.data.requests}
                  </p>
                )}
                {event.data.input_tokens !== undefined && (
                  <p>
                    {t.tokensIn}: {event.data.input_tokens} · {t.tokensOut}:{" "}
                    {event.data.output_tokens ?? 0}
                  </p>
                )}
                {event.data.source_count !== undefined && (
                  <p>
                    {t.sources}: {event.data.source_count}
                  </p>
                )}
                {event.data.reason && (
                  <p>
                    {event.data.reason === "interrupted"
                      ? t.runInterrupted
                      : event.data.reason === "timeout"
                        ? t.runTimedOut
                        : t.generationFailed}
                  </p>
                )}
                {event.data.sources?.map((source) => (
                  <details className="execution-source" key={source.id}>
                    <summary>
                      <span>{source.name}</span>
                      <span>
                        {source.location} · {source.score.toFixed(3)}
                      </span>
                    </summary>
                    <p>{source.excerpt}</p>
                  </details>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {!events.length && (
        <p className="execution-empty">
          {running
            ? t.waitingForAgent
            : failed
              ? t.generationFailed
              : t.noExecutionEvents}
        </p>
      )}
    </section>
  );
}
