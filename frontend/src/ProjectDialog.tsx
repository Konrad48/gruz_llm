import { useEffect, useRef, useState, type FormEvent } from "react";
import { CarFront, X, Plus, LoaderCircle } from "lucide-react";
import { api, json, useGarage, type Project } from "./store";
import { translations } from "./i18n";
import VehicleCombobox from "./VehicleCombobox";

const makes = [
  "BMW",
  "Mercedes-Benz",
  "Volkswagen",
  "Audi",
  "Fiat",
  "FSO",
  "Polski Fiat",
  "Opel",
  "Porsche",
  "Ford",
  "Volvo",
  "Saab",
  "Toyota",
  "Honda",
  "Peugeot",
  "Renault",
  "Škoda",
];
const models: Record<string, string[]> = {
  BMW: ["E21", "E28", "E30", "E34", "E36", "2002"],
  "Mercedes-Benz": ["W123", "W124", "W201", "R107"],
  Volkswagen: ["Golf I", "Golf II", "Golf III", "Passat B3", "Beetle", "T3"],
  Fiat: ["126", "124", "Panda", "Uno"],
  "Polski Fiat": ["126p", "125p"],
  FSO: ["Polonez", "Warszawa", "Syrena"],
  Audi: ["80 B3", "80 B4", "100 C3"],
  Volvo: ["240", "740", "940"],
  Porsche: ["911", "924", "944"],
};

export default function ProjectDialog({
  close,
  onError,
  onCreated,
}: {
  close: () => void;
  onError: (e: unknown) => void;
  onCreated: () => void;
}) {
  const s = useGarage(),
    t = translations[s.language],
    dialog = useRef<HTMLDialogElement>(null);
  const [make, setMake] = useState(""),
    [model, setModel] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const project = await api<Project>(
        "/projects",
        json({
          name: data.get("name"),
          make,
          model,
          year: Number(data.get("year")),
          engine: data.get("engine"),
        }),
      );
      s.set({ projects: [project, ...s.projects] });
      s.selectProject(project.id);
      onCreated();
      close();
    } catch (e) {
      setFailure(
        e instanceof Error && e.message !== "NETWORK"
          ? e.message
          : t.connection,
      );
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="project-dialog"
      aria-labelledby="project-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !busy) close();
      }}
    >
      <div className="dialog-inner">
        <button
          className="icon-button dialog-close"
          disabled={busy}
          aria-label={t.close}
          onClick={close}
        >
          <X size={20} />
        </button>
        <div className="dialog-car">
          <CarFront size={28} strokeWidth={1.5} />
        </div>
        <h2 id="project-dialog-title">{t.projectTitle}</h2>
        <form onSubmit={(e) => void submit(e)}>
          <div className="form-grid">
            <VehicleCombobox
              label={t.make}
              value={make}
              options={makes}
              placeholder="BMW"
              customLabel={t.useCustom}
              hint={t.customHint}
              disabled={busy}
              onChange={(value) => {
                setMake(value);
                setModel("");
              }}
            />
            <VehicleCombobox
              label={t.model}
              value={model}
              options={
                models[
                  makes.find(
                    (option) =>
                      option.toLowerCase() === make.trim().toLowerCase(),
                  ) || make
                ] || []
              }
              placeholder="E30"
              customLabel={t.useCustom}
              hint={t.customHint}
              disabled={busy}
              onChange={setModel}
            />
            <label>
              {t.year}
              <input
                name="year"
                type="number"
                required
                min={1886}
                max={new Date().getFullYear() + 1}
                placeholder="1989"
              />
            </label>
            <label>
              {t.engine}
              <input
                name="engine"
                required
                maxLength={120}
                placeholder={t.enginePlaceholder}
              />
            </label>
          </div>
          <small className="form-hint">{t.customHint}</small>
          <label className="project-name-label">
            {t.name}
            <input
              name="name"
              required
              maxLength={120}
              placeholder={t.namePlaceholder}
            />
          </label>
          {failure && (
            <p className="doc-error" role="alert">
              {failure}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={close}
            >
              {t.cancel}
            </button>
            <button className="primary" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Plus size={16} />
              )}
              {busy ? t.creating : t.create}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
