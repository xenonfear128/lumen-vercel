import lumenMark from "../assets/brand/lumen-mark.png";
import { LANGS, useI18n } from "../i18n";
import { IconButton } from "./Button";
import { Moon, Sun } from "./Icons";
import { cn } from "../utils/cn";

export function TopBar({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const { t, lang, setLang } = useI18n();
  const langIndex = Math.max(0, LANGS.findIndex((l) => l.code === lang));
  const indicatorInset = 0.25 - langIndex * 0.125;
  return (
    <header className="top-bar flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <img src={lumenMark} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-[9px]" />
        <div className="leading-none">
          <div className="text-[15px] font-semibold tracking-tight">{t.appName}</div>
          <div className="mt-0.5 text-[11px] text-muted">{t.tagline}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="lang-switcher glass" role="radiogroup" aria-label={t.language}>
          <span
            aria-hidden="true"
            className="lang-switcher-indicator"
            style={{ left: `calc(${langIndex * 33.333333}% + ${indicatorInset}rem)` }}
          />
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="radio"
              aria-checked={lang === l.code}
              onClick={() => setLang(l.code)}
              className={cn(
                "lang-switcher-option btn h-7 min-w-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium",
                lang === l.code ? "text-[var(--fg)]" : "btn-ghost text-muted",
              )}
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
