"use client";

/**
 * ONE CHAT IN THE SIDEBAR, WITH A MENU (owner, 2026-09-29: "model it after
 * Claude... pin, rename and delete... three dots bring out a menu very close
 * to it"). The row never moves - clicking it always opens the chat. The dots
 * show on hover, on the open chat, and always on touch screens; the menu
 * opens beside them and eases in from that corner.
 *
 * The menu is position: fixed at the dots' own rectangle, so the sidebar's
 * scroll container cannot clip it; it closes on Escape, outside click, scroll
 * and resize.
 */

import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon";
import { HugeiconsIcon } from "@hugeicons/react";

import { CategoryGlyph } from "@/components/category-glyph";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type MenuState = { top: number; left: number; view: "menu" | "confirm" } | null;

const MENU_WIDTH = 190;

export function ChatRow({
  title,
  active,
  pinned,
  onOpen,
  onPin,
  onRename,
  onDelete,
}: {
  title: string;
  active: boolean;
  pinned: boolean;
  onOpen: () => void;
  onPin: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const menuRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !dotsRef.current?.contains(target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        dotsRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  // Focus the first item when the menu (or the confirm view) opens.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu?.view]);

  const openMenu = () => {
    const rect = dotsRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Under the dots, its right edge on theirs, so it opens back over the sidebar (owner, 2026-09-29).
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setMenu({ top: rect.bottom + 4, left, view: "menu" });
  };

  const saveRename = () => {
    setRenaming(false);
    const next = draft.trim().slice(0, 80);
    if (next && next !== title) onRename(next);
    else setDraft(title);
  };

  return (
    <div className="chat-row" data-active={active || undefined} data-menu={menu ? true : undefined}>
      {renaming ? (
        <input
          aria-label="Chat name"
          autoFocus
          className="chat-row__rename"
          maxLength={80}
          onBlur={saveRename}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") saveRename();
            if (event.key === "Escape") {
              setDraft(title);
              setRenaming(false);
            }
          }}
          value={draft}
        />
      ) : (
        <button className="chat-row__open" onClick={onOpen} type="button">
          <span className="chat-row__title">
            {pinned ? (
              <span aria-label="Pinned" className="chat-row__pin">
                <HugeiconsIcon icon={PinIcon} size={12} strokeWidth={2} />
              </span>
            ) : null}
            {/* No ellipsis: a long title runs to the edge and fades out. */}
            <span className="chat-row__text">{title}</span>
          </span>
        </button>
      )}

      {renaming ? null : (
        <button
          aria-expanded={Boolean(menu)}
          aria-haspopup="menu"
          aria-label={`Options for ${title}`}
          className="chat-row__dots"
          onClick={() => (menu ? setMenu(null) : openMenu())}
          ref={dotsRef}
          type="button"
        >
          <CategoryGlyph color="currentColor" name="more" size={15} />
        </button>
      )}

      {/*
        Portalled to <body>: the sidebar is animated with a transform, and a
        transformed ancestor makes position: fixed measure from itself - which
        is why the menu landed over the row instead of under the dots.
      */}
      {menu
        ? createPortal(
        <div
          className="chat-menu"
          ref={menuRef}
          role="menu"
          style={{ top: menu.top, left: menu.left, width: MENU_WIDTH } as CSSProperties}
        >
          {menu.view === "menu" ? (
            <>
              <button
                className="chat-menu__item"
                onClick={() => {
                  onPin();
                  setMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                <HugeiconsIcon icon={pinned ? PinOffIcon : PinIcon} size={15} strokeWidth={1.8} />
                {pinned ? "Unpin" : "Pin"}
              </button>
              <button
                className="chat-menu__item"
                onClick={() => {
                  setDraft(title);
                  setRenaming(true);
                  setMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                <HugeiconsIcon icon={PencilEdit02Icon} size={15} strokeWidth={1.8} />
                Rename
              </button>
              <div className="chat-menu__rule" />
              <button
                className="chat-menu__item chat-menu__item--danger"
                onClick={() => setMenu({ ...menu, view: "confirm" })}
                role="menuitem"
                type="button"
              >
                <HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.8} />
                Delete
              </button>
            </>
          ) : (
            <div className="chat-menu__confirm">
              <p className="text-[0.82rem] font-semibold text-ink">Delete chat?</p>
              <p className="mt-1 text-[0.74rem] leading-5 text-muted">It is removed from our servers too, and cannot be undone.</p>
              <div className="mt-3 flex gap-2">
                <button className="manage-btn manage-btn--quiet !min-h-8 flex-1 !px-2 !text-[0.78rem]" onClick={() => setMenu(null)} type="button">
                  Cancel
                </button>
                <button
                  className="manage-btn manage-btn--danger !min-h-8 flex-1 !px-2 !text-[0.78rem]"
                  onClick={() => {
                    setMenu(null);
                    onDelete();
                  }}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
