import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowUp,
  CarFront,
  ChevronRight,
  Info,
  LoaderCircle,
  Menu,
  Plus,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  useGarage,
  type Chat,
  type Doc,
  type Message,
  type Project,
} from "./store";
import { translations } from "./i18n";
import Sidebar from "./Sidebar";
import GarageView from "./GarageView";
import DocumentsView from "./DocumentsView";
import ProjectDialog from "./ProjectDialog";
import { LiveExecutionActivity } from "./ExecutionDetails";
import MessageInsightsDrawer from "./MessageInsightsDrawer";
import { streamTurn } from "./chatStream";

export default function App() {
  const s = useGarage(),
    t = translations[s.language];
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [configured, setConfigured] = useState(true);
  const [newProject, setNewProject] = useState(false),
    [mobile, setMobile] = useState(false);
  const [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false),
    [uploading, setUploading] = useState(false),
    [messagesLoading, setMessagesLoading] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [insightsMessageId, setInsightsMessageId] = useState<string | null>(
    null,
  );
  const insightsMessage = s.messages.find(
    (message) => message.id === insightsMessageId,
  );
  useEffect(() => {
    setInsightsMessageId(null);
  }, [s.selectedChat, s.selectedProject, s.view]);
  const end = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    messageRequest = useRef(0),
    sendingRef = useRef(false);
  const conversation = useRef<HTMLDivElement>(null),
    followBottom = useRef(true);
  const hasRunningMessage = s.messages.some(
    (message) => message.status === "generating",
  );
  const generating = sending || hasRunningMessage;
  const project = s.projects.find((p) => p.id === s.selectedProject);
  const report = (e: unknown) =>
    setError(
      e instanceof Error
        ? e.message === "NETWORK"
          ? t.connection
          : e.message
        : t.error,
    );

  async function boot() {
    setLoading(true);
    setError("");
    try {
      const [projects, health] = await Promise.all([
        api<Project[]>("/projects"),
        api<{ ai_configured: boolean }>("/health"),
      ]);
      const state = useGarage.getState();
      const id = projects.some((p) => p.id === state.selectedProject)
        ? state.selectedProject
        : (projects[0]?.id ?? null);
      s.set({
        projects,
        selectedProject: id,
        ...(id !== state.selectedProject
          ? { selectedChat: null, messages: [] }
          : {}),
        recentProjects: [...new Set([id, ...state.recentProjects])]
          .filter(
            (item): item is string =>
              !!item && projects.some((p) => p.id === item),
          )
          .slice(0, 5),
      });
      setConfigured(health.ai_configured);
    } catch (e) {
      report(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void boot();
  }, []);
  useEffect(() => {
    document.documentElement.lang = s.language;
  }, [s.language]);
  useEffect(() => {
    const id = s.selectedProject;
    if (!id) return;
    let live = true;
    const refresh = async () => {
      try {
        const [docs, chats] = await Promise.all([
          api<Doc[]>(`/projects/${id}/documents`),
          api<Chat[]>(`/projects/${id}/chats`),
        ]);
        if (live && useGarage.getState().selectedProject === id)
          s.set({ docs, chats });
      } catch (e) {
        if (live) report(e);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [s.selectedProject]);
  useEffect(() => {
    const id = s.selectedChat,
      request = ++messageRequest.current;
    if (!id) {
      setMessagesLoading(false);
      return;
    }
    if (sendingRef.current) {
      setMessagesLoading(false);
      return;
    }
    setMessagesLoading(true);
    api<Message[]>(`/chats/${id}/messages`)
      .then((messages) => {
        if (
          messageRequest.current === request &&
          useGarage.getState().selectedChat === id
        )
          s.set({ messages });
      })
      .catch((e) => {
        if (messageRequest.current === request) report(e);
      })
      .finally(() => {
        if (messageRequest.current === request) setMessagesLoading(false);
      });
    return () => {
      messageRequest.current++;
    };
  }, [s.selectedChat]);
  useEffect(() => {
    if (sending || !hasRunningMessage || !s.selectedChat) return;
    const id = s.selectedChat;
    let live = true;
    async function refreshGeneration() {
      try {
        const messages = await api<Message[]>(`/chats/${id}/messages`);
        if (live && useGarage.getState().selectedChat === id) {
          s.set({ messages });
          if (!messages.some((message) => message.status === "generating"))
            setConnectionLost(false);
        }
      } catch {
        if (live) setConnectionLost(true);
      }
    }
    void refreshGeneration();
    const interval = setInterval(() => void refreshGeneration(), 1000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [sending, hasRunningMessage, s.selectedChat]);
  useEffect(() => {
    if (
      followBottom.current &&
      s.view === "chat" &&
      (s.messages.length || sending)
    )
      end.current?.scrollIntoView({ behavior: "smooth" });
  }, [s.messages.length, s.messages.at(-1)?.content, sending, s.view]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 10000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    function closeNavigation(event: KeyboardEvent) {
      if (event.key === "Escape") setMobile(false);
    }
    document.addEventListener("keydown", closeNavigation);
    return () => document.removeEventListener("keydown", closeNavigation);
  }, []);

  function chooseProject(id: string) {
    if (generating) return;
    followBottom.current = true;
    if (id === s.selectedProject) s.set({ view: "chat" });
    else {
      s.selectProject(id);
      setDraft("");
    }
    setMobile(false);
    setMessagesLoading(false);
  }
  function chooseChat(id: string | null) {
    if (generating) return;
    followBottom.current = true;
    s.selectChat(id);
    setMobile(false);
    setDraft("");
  }
  function navigate(view: "garage" | "documents") {
    s.set({ view });
    setMobile(false);
  }
  function addProject() {
    if (!generating) {
      setMobile(false);
      setNewProject(true);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    await sendQuestion(draft);
  }
  async function sendQuestion(content: string, retryId?: string) {
    if (
      !content.trim() ||
      !project ||
      generating ||
      sendingRef.current ||
      messagesLoading ||
      !configured
    )
      return;
    const question = content.trim(),
      projectId = project.id,
      optimisticId = crypto.randomUUID();
    sendingRef.current = true;
    followBottom.current = true;
    messageRequest.current++;
    setMessagesLoading(false);
    setSending(true);
    setError("");
    setConnectionLost(false);
    setDraft("");
    s.set({
      messages: [
        ...s.messages.filter((message) => message.id !== retryId),
        {
          id: optimisticId,
          role: "user",
          content: question,
          sources: [],
          status: "complete",
        },
      ],
    });
    let chatId = s.selectedChat;
    try {
      if (!chatId) {
        const chat = await api<Chat>(`/projects/${projectId}/chats`, {
          method: "POST",
        });
        chatId = chat.id;
        s.set({ selectedChat: chatId, chats: [chat, ...s.chats] });
      }
      await streamTurn(
        chatId,
        {
          content: question,
          language: s.language,
          client_message_id: optimisticId,
        },
        (event) => {
          if (useGarage.getState().selectedProject !== projectId) return;
          const messages = useGarage.getState().messages;
          if (event.type === "accepted") {
            const ids = new Set(event.messages.map((message) => message.id));
            s.set({
              messages: [
                ...messages.filter((message) => !ids.has(message.id)),
                ...event.messages,
              ],
            });
          } else if (event.type === "activity") {
            const retrieved = event.event.data.sources || [];
            s.set({
              messages: messages.map((message) =>
                message.id === event.message_id
                  ? {
                      ...message,
                      execution: [...(message.execution || []), event.event],
                      sources: [
                        ...new Map(
                          [...message.sources, ...retrieved].map((source) => [
                            source.id,
                            source,
                          ]),
                        ).values(),
                      ],
                    }
                  : message,
              ),
            });
          } else if (event.type === "complete" || event.type === "failed") {
            s.set({
              messages: messages.map((message) =>
                message.id === event.message.id ? event.message : message,
              ),
            });
          }
        },
      );
    } catch (e) {
      let recovered = false;
      if (chatId) {
        try {
          const messages = await api<Message[]>(`/chats/${chatId}/messages`);
          if (messages.some((message) => message.id === optimisticId)) {
            s.set({ messages });
            recovered = true;
            setConnectionLost(
              messages.some((message) => message.status === "generating"),
            );
          }
        } catch {
          /* Keep the local message visible if reconciliation is unavailable. */
        }
      }
      if (!recovered) {
        s.set({
          messages: useGarage
            .getState()
            .messages.map((message) =>
              message.id === optimisticId
                ? { ...message, status: "failed" }
                : message,
            ),
        });
        report(e);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      if (chatId) {
        try {
          const chats = await api<Chat[]>(`/projects/${projectId}/chats`);
          if (useGarage.getState().selectedProject === projectId)
            s.set({ chats });
        } catch {
          /* The existing conversation remains usable. */
        }
      }
      requestAnimationFrame(() => composer.current?.focus());
    }
  }
  async function upload(files: FileList | null) {
    if (!files || !project) return;
    const id = project.id;
    setUploading(true);
    try {
      for (const item of Array.from(files)) {
        if (item.size > 20 * 1024 * 1024) throw new Error(t.uploadHint);
        const form = new FormData();
        form.append("file", item);
        await api<Doc>(`/projects/${id}/documents`, {
          method: "POST",
          body: form,
        });
      }
      const docs = await api<Doc[]>(`/projects/${id}/documents`);
      if (useGarage.getState().selectedProject === id) s.set({ docs });
    } catch (e) {
      report(e);
    } finally {
      setUploading(false);
    }
  }
  async function removeDoc(doc: Doc) {
    if (!confirm(t.deleteDoc)) return;
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      s.set({ docs: useGarage.getState().docs.filter((d) => d.id !== doc.id) });
    } catch (e) {
      report(e);
    }
  }
  async function removeProject(target: Project) {
    if (generating || !confirm(t.deleteProject)) return;
    try {
      await api(`/projects/${target.id}`, { method: "DELETE" });
      const state = useGarage.getState(),
        projects = state.projects.filter((p) => p.id !== target.id);
      const recentProjects = state.recentProjects.filter(
        (id) => id !== target.id,
      );
      s.set({ projects, recentProjects });
      if (state.selectedProject === target.id) {
        const next = recentProjects[0] ?? projects[0]?.id;
        if (next) s.selectProject(next);
        else
          s.set({
            selectedProject: null,
            selectedChat: null,
            chats: [],
            docs: [],
            messages: [],
          });
        setDraft("");
      }
      s.set({ view: "garage" });
    } catch (e) {
      report(e);
    }
  }
  const view = !project ? "garage" : s.view;
  const title =
    view === "garage"
      ? t.garage
      : view === "documents"
        ? t.documents
        : s.chats.find((chat) => chat.id === s.selectedChat)?.title ||
          t.conversation;

  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="nav-scrim"
          aria-label={t.close}
          onClick={() => setMobile(false)}
        />
      )}
      <Sidebar
        mobile={mobile}
        sending={generating}
        chooseProject={chooseProject}
        chooseChat={chooseChat}
        renameChat={async (id, title) => {
          try {
            const chat = await api<Chat>(`/chats/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
            const state = useGarage.getState();
            s.set({
              chats: state.chats.map((item) => (item.id === id ? chat : item)),
            });
            return true;
          } catch (e) {
            report(e);
            return false;
          }
        }}
        deleteChat={async (id) => {
          try {
            await api(`/chats/${id}`, { method: "DELETE" });
            const state = useGarage.getState();
            s.set({
              chats: state.chats.filter((chat) => chat.id !== id),
              ...(state.selectedChat === id
                ? { selectedChat: null, messages: [] }
                : {}),
            });
          } catch (e) {
            report(e);
          }
        }}
        navigate={navigate}
        addProject={addProject}
      />
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label={t.mobileMenu}
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            {project && view !== "garage" && (
              <>
                <button
                  disabled={generating}
                  onClick={() => chooseProject(project.id)}
                >
                  {project.name}
                </button>
                <ChevronRight size={13} />
              </>
            )}
            <span>{title === "New conversation" ? t.conversation : title}</span>
          </div>
        </header>
        {loading ? (
          <div className="center-state">
            <LoaderCircle className="spin" size={24} />
            <span>{t.loading}</span>
          </div>
        ) : view === "garage" ? (
          <GarageView
            addProject={addProject}
            chooseProject={chooseProject}
            removeProject={removeProject}
            busy={generating}
          />
        ) : view === "documents" ? (
          <DocumentsView
            key={project!.id}
            configured={configured}
            uploading={uploading}
            upload={upload}
            removeDoc={removeDoc}
          />
        ) : (
          <>
            <div
              ref={conversation}
              onScroll={() => {
                const element = conversation.current;
                if (element)
                  followBottom.current =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    96;
              }}
              className={`conversation ${!s.messages.length ? "empty-conversation" : ""}`}
            >
              {messagesLoading ? (
                <div className="center-state">
                  <LoaderCircle className="spin" size={23} />
                </div>
              ) : !s.messages.length ? (
                <div className="chat-empty">
                  <CarFront size={32} strokeWidth={1.2} />
                  <h1>{project!.name}</h1>
                  <p>
                    {project!.year} {project!.make} {project!.model} ·{" "}
                    {project!.engine}
                  </p>
                </div>
              ) : (
                <div className="message-list">
                  {s.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message ${message.role}`}
                    >
                      <div className="message-heading">
                        {message.role === "assistant" && <Wrench size={14} />}
                        <strong>
                          {message.role === "assistant" ? t.assistant : t.you}
                        </strong>
                      </div>
                      <div className="markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      {message.role === "user" &&
                        message.status === "failed" && (
                          <div className="message-send-error">
                            <span>{t.notSent}</span>
                            <button
                              disabled={generating}
                              onClick={() =>
                                void sendQuestion(message.content, message.id)
                              }
                            >
                              {t.retrySend}
                            </button>
                          </div>
                        )}
                      {message.role === "assistant" &&
                        message.status === "generating" && (
                          <LiveExecutionActivity
                            events={message.execution || []}
                            connectionLost={connectionLost}
                          />
                        )}
                      {message.role === "assistant" &&
                        message.status === "failed" && (
                          <p className="generation-error" role="alert">
                            {t.generationFailed}
                          </p>
                        )}
                      {message.role === "assistant" && (
                        <button
                          className="sources-link"
                          aria-haspopup="dialog"
                          aria-expanded={insightsMessageId === message.id}
                          onClick={() => setInsightsMessageId(message.id)}
                        >
                          {t.sources} ({message.sources?.length || 0})
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {sending && !hasRunningMessage && (
                <div className="thinking" role="status">
                  <LoaderCircle className="spin" size={15} />
                  {t.waitingForAgent}
                </div>
              )}
              <div ref={end} />
            </div>
            <div className="composer-area">
              {!configured && (
                <div className="setup-notice">
                  <Info size={16} />
                  <div>
                    <strong>{t.apiMissing}</strong>
                    <p>{t.apiMissingSub}</p>
                  </div>
                </div>
              )}
              <form
                className="composer"
                aria-busy={generating}
                onSubmit={(e) => void send(e)}
              >
                <textarea
                  ref={composer}
                  aria-label={t.askPlaceholder}
                  placeholder={
                    generating ? t.generationLocked : t.askPlaceholder
                  }
                  value={draft}
                  rows={2}
                  maxLength={12000}
                  disabled={generating}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="composer-tools">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={generating}
                    aria-label={t.documents}
                    title={t.documents}
                    onClick={() => navigate("documents")}
                  >
                    <Plus size={19} />
                  </button>
                  <button
                    className="send"
                    type="submit"
                    aria-label={t.send}
                    disabled={
                      !draft.trim() ||
                      generating ||
                      !configured ||
                      messagesLoading
                    }
                  >
                    {generating ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <ArrowUp size={19} />
                    )}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </main>
      {error && (
        <div className="toast" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          {!project && (
            <button className="text-button" onClick={() => void boot()}>
              {t.retry}
            </button>
          )}
          <button
            className="icon-button"
            aria-label={t.close}
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {newProject && (
        <ProjectDialog
          close={() => setNewProject(false)}
          onError={report}
          onCreated={() => {
            setDraft("");
            setMobile(false);
          }}
        />
      )}
      {insightsMessage && (
        <MessageInsightsDrawer
          key={insightsMessage.id}
          message={insightsMessage}
          close={() => setInsightsMessageId(null)}
        />
      )}
    </div>
  );
}
