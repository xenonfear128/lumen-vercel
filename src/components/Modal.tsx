import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import { X } from "./Icons";
import { useI18n } from "../i18n";
import { cn } from "../utils/cn";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panel.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]') || []).filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length-1];
        if (!first) { e.preventDefault(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6" role="dialog" aria-modal aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[6px] fade-in dark:bg-black/50" onClick={onClose} />
      <div
        ref={panel} tabIndex={-1}
        className={cn(
          "glass-strong glass-sheen relative min-w-0 w-full rounded-[28px] p-5 sm:p-7 fade-in max-h-[calc(100dvh-3rem)] overflow-y-auto [overflow-wrap:anywhere]",
          width,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[19px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>}
          </div>
          <IconButton label={t.close} onClick={onClose} size={36} variant="soft">
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
