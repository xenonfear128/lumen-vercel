import { LANGS, useI18n } from "../i18n";
import { IconButton } from "./Button";
import { Moon, Sun } from "./Icons";
import { cn } from "../utils/cn";

export function TopBar({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent)] text-[var(--accent-fg)]">
          <span className="block h-3 w-3 rounded-full border-[2.5px] border-current" />
        </div>
        <div className="leading-none">
          <div className="text-[15px] font-semibold tracking-tight">{t.appName}</div>
          <div className="mt-0.5 text-[11px] text-muted">{t.tagline}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="glass inline-flex items-center gap-0.5 rounded-full p-1" role="radiogroup" aria-label={t.language}>
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="radio"
              aria-checked={lang === l.code}
              onClick={() => setLang(l.code)}
              className={cn("btn h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium", lang === l.code ? "btn-active" : "btn-ghost text-muted")}
            >
              {l.label}
            </button>
          ))}
        </div>
        <IconButton label={dark ? t.light : t.dark} onClick={onToggleTheme} size={36} className="glass">
          <span key={dark ? "d" : "l"} className="fade-in flex">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </span>
        </IconButton>
      </div>
    </header>
  );
}
