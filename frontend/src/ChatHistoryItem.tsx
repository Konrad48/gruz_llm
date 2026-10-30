import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Ellipsis,
  MessageSquare,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useGarage, type Chat } from "./store";
import { translations } from "./i18n";

export default function ChatHistoryItem({
  chat,
  disabled,
  selected,
  chooseChat,
  renameChat,
  deleteChat,
}: {
  chat: Chat;
  disabled: boolean;
  selected: boolean;
  chooseChat: (id: string) => void;
  renameChat: (id: string, title: string) => Promise<boolean>;
  deleteChat: (id: string) => Promise<void>;
}) {
  const t = translations[useGarage((state) => state.language)];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const label = chat.title === "New conversation" ? t.defaultChat : chat.title;

  useLayoutEffect(() => {
    if (!open) return;
    function positionMenu() {
      if (!trigger.current || !menu.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = menu.current.getBoundingClientRect();
      const gap = 6;
      const top =
        anchor.bottom + gap + bounds.height <= window.innerHeight - gap
          ? anchor.bottom + gap
          : anchor.top - bounds.height - gap;
      setPosition({
        top: Math.max(gap, top),
        left: Math.max(
          gap,
          Math.min(
            anchor.right - bounds.width,
            window.innerWidth - bounds.width - gap,
          ),
        ),
      });
    }
    positionMenu();
    window.addEventListener("resize", positionMenu);
    document.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      document.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        !row.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    menu.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setEditing(false);
    }
  }, [disabled]);

  function finishEditing() {
    setEditing(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  return (
    <div
      className={`chat-row ${selected ? "selected" : ""} ${open ? "menu-open" : ""}`}
      ref={row}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !menu.current?.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      {editing ? (
        <form
          className="chat-rename"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || disabled || !title.trim()) return;
            setBusy(true);
            try {
              if (await renameChat(chat.id, title.trim())) finishEditing();
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            ref={input}
            value={title}
            maxLength={100}
            aria-label={t.renameChat}
            disabled={busy || disabled}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                event.preventDefault();
                finishEditing();
              }
            }}
          />
          <button
            className="icon-button"
            aria-label={t.save}
            title={t.save}
            disabled={busy || disabled || !title.trim()}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t.cancel}
            title={t.cancel}
            disabled={busy}
            onClick={finishEditing}
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <>
          <button
            className="chat-item"
            disabled={disabled || busy}
            onClick={() => chooseChat(chat.id)}
            title={label}
          >
            <MessageSquare size={15} />
            <span>{label}</span>
          </button>
          <button
            ref={trigger}
            className="icon-button chat-actions"
            disabled={disabled || busy}
            aria-label={`${t.chatOptions}: ${label}`}
            title={t.chatOptions}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={`chat-menu-${chat.id}`}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <Ellipsis size={17} />
          </button>
        </>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            style={position}
            className="chat-menu"
            role="menu"
            id={`chat-menu-${chat.id}`}
            aria-label={t.chatOptions}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                trigger.current?.focus();
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]',
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
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setTitle(label);
                setEditing(true);
              }}
            >
              <Pencil size={14} />
              {t.renameChat}
            </button>
            <button
              role="menuitem"
              className="chat-delete"
              onClick={async () => {
                setOpen(false);
                trigger.current?.focus();
                if (!window.confirm(`${t.deleteChat}\n\n${label}`)) return;
                setBusy(true);
                try {
                  await deleteChat(chat.id);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 size={14} />
              {t.delete}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
