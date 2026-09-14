import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

type Variant = "primary" | "ghost" | "soft";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}

export function Button({ variant = "soft", active, size = "md", icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cn(
        "btn inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-tight",
        size === "sm" && "h-8 px-3 text-[12.5px]",
        size === "md" && "h-10 px-4 text-[13.5px]",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-ghost",
        variant === "soft" && "btn-soft",
        active && "btn-active",
        className,
      )}
      {...rest}
    >
      {icon && <span className="shrink-0 -ml-0.5">{icon}</span>}
      {children}
    </button>
  );
}

interface IconBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  size?: number;
  label: string;
}

export function IconButton({ variant = "ghost", active, size = 40, label, className, children, ...rest }: IconBtnProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        "btn inline-flex shrink-0 items-center justify-center rounded-full",
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-ghost",
        variant === "soft" && "btn-soft",
        active && "btn-active",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("segmented-control inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[20px] p-1 glass", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "btn h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium",
            value === o.value ? "btn-active" : "btn-ghost text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
