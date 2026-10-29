import { useState } from "react";
import { CarFront, Info, Plus, Search, Trash2, X } from "lucide-react";
import { useGarage, type Project } from "./store";
import { translations } from "./i18n";

export default function GarageView({
  addProject,
  chooseProject,
  removeProject,
  busy,
}: {
  addProject: () => void;
  chooseProject: (id: string) => void;
  removeProject: (project: Project) => Promise<void>;
  busy: boolean;
}) {
  const s = useGarage(),
    t = translations[s.language];
  const [query, setQuery] = useState(""),
    [detailsId, setDetailsId] = useState<string | null>(null);
  const details = s.projects.find((p) => p.id === detailsId);
  const projects = s.projects.filter((p) =>
    `${p.name} ${p.make} ${p.model} ${p.year} ${p.engine}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="workspace-view" aria-label={t.garage}>
      <div className="view-toolbar">
        <h1>
          {t.garage}
          <span className="view-count">{s.projects.length}</span>
        </h1>
        <button className="primary" disabled={busy} onClick={addProject}>
          <Plus size={16} />
          {t.addProject}
        </button>
      </div>
      <div className="view-controls">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label={t.searchProjects}
            placeholder={t.searchProjects}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="workspace-body">
        <div className="workspace-content">
          {!projects.length ? (
            <div className="empty-view">
              <CarFront size={34} strokeWidth={1.3} />
              <h2>{query ? t.noResults : t.emptyGarage}</h2>
              {!query && (
                <>
                  <p>{t.emptyGarageHint}</p>
                  <button className="secondary" onClick={addProject}>
                    <Plus size={15} />
                    {t.addProject}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="garage-grid">
              {projects.map((p, index) => (
                <article
                  key={p.id}
                  className={`garage-card ${p.id === s.selectedProject ? "current" : ""}`}
                >
                  <button
                    className="car-preview"
                    data-color={index % 4}
                    disabled={busy}
                    aria-label={`${t.openProject}: ${p.name}`}
                    onClick={() => chooseProject(p.id)}
                  >
                    <CarFront size={76} strokeWidth={1} />
                    <span>{p.make}</span>
                  </button>
                  <div className="garage-card-bottom">
                    <button
                      className="garage-card-name"
                      disabled={busy}
                      onClick={() => chooseProject(p.id)}
                    >
                      <strong>{p.name}</strong>
                      <span>
                        {p.year} {p.make} {p.model}
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${t.details}: ${p.name}`}
                      aria-pressed={p.id === detailsId}
                      onClick={() =>
                        setDetailsId(p.id === detailsId ? null : p.id)
                      }
                    >
                      <Info size={18} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        {details && (
          <aside className="detail-panel" aria-label={t.projectDetails}>
            <div className="detail-heading">
              <h2>{t.projectDetails}</h2>
              <button
                className="icon-button"
                aria-label={t.close}
                onClick={() => setDetailsId(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="detail-preview">
              <CarFront size={58} strokeWidth={1.2} />
            </div>
            <h3>{details.name}</h3>
            <dl>
              {[
                [t.make, details.make],
                [t.model, details.model],
                [t.year, details.year],
                [t.engine, details.engine],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <button
              className="secondary full-width"
              disabled={busy}
              onClick={() => chooseProject(details.id)}
            >
              {t.openProject}
            </button>
            <button
              className="danger-link"
              disabled={busy}
              onClick={() => void removeProject(details)}
            >
              <Trash2 size={15} />
              {t.deleteProjectLabel}
            </button>
          </aside>
        )}
      </div>
    </section>
  );
}
