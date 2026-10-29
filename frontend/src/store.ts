import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Language } from "./i18n";
export type Theme = "dark" | "light" | "system";
export interface Project {
  id: string;
  name: string;
  make: string;
  model: string;
  year: number;
  engine: string;
}
export interface Chat {
  id: string;
  project_id: string;
  title: string;
}
export interface Source {
  id: string;
  document_id: string;
  name: string;
  location: string;
  excerpt: string;
  score: number;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  status?: "complete" | "generating" | "failed";
  execution?: ExecutionEvent[];
}
export interface ExecutionEvent {
  id: number;
  kind: string;
  timestamp: string;
  elapsed_ms: number;
  data: {
    query?: string;
    model?: string;
    method?: string;
    limit?: number;
    count?: number;
    sources?: Source[];
    dimensions?: number;
    tool?: string;
    call_id?: string;
    arguments?: Record<string, unknown>;
    request?: number;
    requests?: number;
    input_tokens?: number;
    output_tokens?: number;
    source_count?: number;
    reason?: string;
    vehicle?: string;
  };
}
export interface Doc {
  id: string;
  name: string;
  size: number;
  status: string;
  error: string | null;
  chunk_count: number;
  created_at: string;
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error("NETWORK");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `Request failed (${response.status})`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
interface State {
  language: Language;
  theme: Theme;
  selectedProject: string | null;
  selectedChat: string | null;
  view: "chat" | "documents" | "garage";
  recentProjects: string[];
  projects: Project[];
  chats: Chat[];
  messages: Message[];
  docs: Doc[];
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  selectProject: (id: string) => void;
  selectChat: (id: string | null) => void;
  set: (state: Partial<State>) => void;
}
export const useGarage = create<State>()(
  persist(
    (set) => ({
      language: "en",
      theme: "system",
      selectedProject: null,
      selectedChat: null,
      view: "chat",
      recentProjects: [],
      projects: [],
      chats: [],
      messages: [],
      docs: [],
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      selectProject: (id) =>
        set((state) => ({
          selectedProject: id,
          view: "chat",
          recentProjects: [
            id,
            ...state.recentProjects.filter((item) => item !== id),
          ].slice(0, 5),
          selectedChat: null,
          chats: [],
          messages: [],
          docs: [],
        })),
      selectChat: (id) => set({ selectedChat: id, messages: [], view: "chat" }),
      set: (state) => set(state),
    }),
    {
      name: "gruz-preferences",
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        selectedProject: state.selectedProject,
        selectedChat: state.selectedChat,
        recentProjects: state.recentProjects,
      }),
    },
  ),
);
