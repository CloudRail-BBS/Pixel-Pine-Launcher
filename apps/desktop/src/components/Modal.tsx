import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  /** 标题下方、表单上方的一块区域，放提示条之类 */
  children: ReactNode;
  footer?: ReactNode;
  /** 关掉弹层。Esc、点遮罩、点关闭按钮都会走到这里 */
  onClose: () => void;
  /** 不允许点遮罩关闭（比如正在上传） */
  dismissable?: boolean;
  width?: number;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * 统一的弹层。
 *
 * 自己写而不是引组件库，是因为需要的就这几件事：
 * 焦点锁在层内、Esc 关闭、关掉后焦点回到打开它的按钮。
 * 少一个，键盘用户就会被困住或者掉进背后的页面里。
 */
export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  dismissable = true,
  width = 440,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const close = useCallback(() => {
    if (dismissable) onClose();
  }, [dismissable, onClose]);

  // 打开时记住谁把弹层叫出来的，关闭时还回去
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    // 首焦点给第一个可聚焦元素，没有就给面板本身
    const timer = window.setTimeout(() => {
      const node = panel.current;
      if (!node) return;
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }, 30);

    return () => {
      window.clearTimeout(timer);
      restoreTo.current?.focus?.();
    };
  }, [open]);

  // Esc 关闭 + Tab 在层内循环
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const node = panel.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null,
      );
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // 打开时锁滚动，避免背景跟着滚
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        // 只有点在遮罩本身才算「点外面」，点面板内部冒上来的不算
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        ref={panel}
        tabIndex={-1}
        style={{ maxWidth: width }}
      >
        <div className="modal-head">
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
          {dismissable && (
            <button className="modal-close" onClick={close} aria-label="关闭">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        {description && (
          <p className="modal-desc" id={descId}>
            {description}
          </p>
        )}

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
