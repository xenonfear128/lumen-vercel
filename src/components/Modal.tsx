import { useEffect, type ReactNode } from "react";
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[6px] fade-in dark:bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "glass-strong glass-sheen relative min-w-0 w-full rounded-[28px] p-5 sm:p-7 fade-in max-h-[calc(100dvh-3rem)] overflow-y-auto [overflow-wrap:anywhere]",
          width,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold tracking-tight">{title}</h2>
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
