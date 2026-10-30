import { useEffect, useRef, useState } from "react";
import {
  CarFront,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  LayoutGrid,
  Monitor,
  Moon,
  Plus,
  Sun,
  Wrench,
} from "lucide-react";
import { useGarage, type Project } from "./store";
import { translations } from "./i18n";
import ChatHistoryItem from "./ChatHistoryItem";

export default function Sidebar({
  mobile,
  sending,
  chooseProject,
  chooseChat,
  renameChat,
  deleteChat,
  navigate,
  addProject,
}: {
  mobile: boolean;
  sending: boolean;
  chooseProject: (id: string) => void;
  chooseChat: (id: string | null) => void;
  renameChat: (id: string, title: string) => Promise<boolean>;
  deleteChat: (id: string) => Promise<void>;
  navigate: (view: "garage" | "documents") => void;
  addProject: () => void;
}) {
  const s = useGarage(),
    t = translations[s.language];
  const [expanded, setExpanded] = useState(false);
  const switcher = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const project = s.projects.find((p) => p.id === s.selectedProject);
  const recent = [...new Set([s.selectedProject, ...s.recentProjects])]
    .flatMap((id) => {
      const item = s.projects.find((p) => p.id === id);
      return item ? [item] : [];
    })
    .slice(0, 5);
  useEffect(() => {
    if (!expanded) return;
    function outside(event: PointerEvent) {
      if (!switcher.current?.contains(event.target as Node)) setExpanded(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  function menuAction(action: () => void) {
    setExpanded(false);
    action();
  }
  function projectLabel(p: Project) {
    return (
      <span className="project-label">
        <strong>{p.name}</strong>
        <small>
          {p.make} {p.model} · {p.year}
        </small>
      </span>
    );
  }
  return (
    <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
      <a href="/" className="brand">
        <span className="brand-icon">
          <Wrench size={18} />
        </span>
        <span>
          gruz<span className="brand-light"> llm</span>
        </span>
      </a>
      <div className="sidebar-heading">{t.project}</div>
      <div
        className="project-switcher"
        ref={switcher}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setExpanded(false);
        }}
      >
        <button
          ref={trigger}
          className="current-project"
          disabled={sending}
          aria-expanded={expanded}
          aria-haspopup="menu"
          aria-controls="project-menu"
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setExpanded(true);
              requestAnimationFrame(() =>
                switcher.current
                  ?.querySelector<HTMLButtonElement>(
                    '[role="menuitemradio"], [role="menuitem"]',
                  )
                  ?.focus(),
              );
            }
          }}
        >
          <span className="car-icon">
            <CarFront size={21} />
          </span>
          {project ? projectLabel(project) : <span>{t.selectProject}</span>}
          <ChevronDown size={15} className={expanded ? "rotated" : ""} />
        </button>
        {expanded && (
          <div
            className="project-menu"
            role="menu"
            id="project-menu"
            aria-label={t.selectProject}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setExpanded(false);
                trigger.current?.focus();
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitemradio"], [role="menuitem"]',
                  ),
                );
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                items[
                  (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                    items.length
                ]?.focus();
              }
            }}
          >
            {recent.length > 0 && (
              <div className="menu-caption">{t.recent}</div>
            )}
            {recent.map((p) => (
              <button
                className="project-menu-item"
                role="menuitemradio"
                aria-checked={p.id === project?.id}
                key={p.id}
                onClick={() => menuAction(() => chooseProject(p.id))}
              >
                <CarFront size={17} />
                {projectLabel(p)}
                {p.id === project?.id && <Check size={15} />}
              </button>
            ))}
            <div className="project-menu-actions">
              <button role="menuitem" onClick={() => menuAction(addProject)}>
                <Plus size={16} />
                {t.addProject}
              </button>
              <button
                role="menuitem"
                onClick={() => menuAction(() => navigate("garage"))}
              >
                <LayoutGrid size={16} />
                {t.goToGarage}
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        className={`sidebar-nav ${s.view === "documents" ? "selected" : ""}`}
        disabled={!project}
        onClick={() => navigate("documents")}
      >
        <FileText size={17} />
        {t.documents}
      </button>
      <div className="sidebar-heading conversation-heading">
        <span>{t.conversations}</span>
        <button
          className="icon-button"
          disabled={!project || sending}
          aria-label={t.newChat}
          title={t.newChat}
          onClick={() => chooseChat(null)}
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="chat-list">
        {s.chats.map((chat) => (
          <ChatHistoryItem
            key={chat.id}
            chat={chat}
            disabled={sending}
            selected={s.view === "chat" && s.selectedChat === chat.id}
            chooseChat={chooseChat}
            renameChat={renameChat}
            deleteChat={deleteChat}
          />
        ))}
        {!s.chats.length && <p className="sidebar-empty">{t.noChats}</p>}
      </div>
      <div className="sidebar-bottom">
        <div className="theme-switcher" role="group" aria-label={t.theme}>
          {(
            [
              ["dark", Moon, t.themeDark],
              ["light", Sun, t.themeLight],
              ["system", Monitor, t.themeSystem],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={s.theme === value}
              onClick={() => s.setTheme(value)}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button
          className="language"
          aria-label={t.language}
          onClick={() => s.setLanguage(s.language === "en" ? "pl" : "en")}
        >
          <Globe2 size={15} />
          <span>{s.language === "en" ? "English" : "Polski"}</span>
          <span className="locale-code">{s.language.toUpperCase()}</span>
        </button>
      </div>
    </aside>
  );
}
