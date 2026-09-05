import { EQ_BANDS, EQ_MAX, EQ_MIN, EQ_PRESETS, computeAutoPreamp, type PresetKey } from "../lib/audioEngine";
import { useI18n } from "../i18n";
import type { Player } from "../hooks/usePlayer";
import { Button } from "./Button";
import { cn } from "../utils/cn";

function fmtHz(f: number) {
  return f >= 1000 ? `${f / 1000}k` : `${f}`;
}

export function Equalizer({ player }: { player: Player }) {
  const { t } = useI18n();
  const { eq, setEqBand, setEqPreset, setEqEnabled, setEqPreamp, setEqAutoGain, resetEq } = player;
  const effectivePreamp = eq.autoGain ? computeAutoPreamp(eq.gains) : eq.preamp;

  return (
    <div className="space-y-6">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-3 select-none">
          <Toggle checked={eq.enabled} onChange={setEqEnabled} />
          <span className="text-[13.5px] font-medium">{t.eqEnabled}</span>
        </label>
        <Button size="sm" variant="soft" onClick={resetEq}>
          {t.reset}
        </Button>
      </div>

      {/* presets */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.preset}</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(EQ_PRESETS) as PresetKey[]).map((k) => (
            <Button key={k} size="sm" variant="soft" active={eq.preset === k} onClick={() => setEqPreset(k)}>
              {t.presets[k]}
            </Button>
          ))}
          {eq.preset === "custom" && (
            <Button size="sm" variant="soft" active>
              {t.presets.custom}
            </Button>
          )}
        </div>
      </div>

      {/* bands */}
      <div className={cn("transition-opacity duration-300", !eq.enabled && "opacity-40 pointer-events-none")}>
        <div className="overflow-x-auto rounded-2xl border border-line" tabIndex={0}>
          <div className="relative min-w-[32rem] p-4 pt-6">
            {/* grid lines */}
            <div className="pointer-events-none absolute inset-x-4 top-6 bottom-[52px] flex flex-col justify-between">
              {[12, 6, 0, -6, -12].map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <div className={cn("h-px flex-1", v === 0 ? "bg-current opacity-25" : "bg-line")} />
                  <span className="w-7 text-right font-mono text-[10px] text-muted tnum">{v > 0 ? `+${v}` : v}</span>
                </div>
              ))}
            </div>
            <div className="relative grid grid-cols-10 gap-1 pr-9">
              {EQ_BANDS.map((f, i) => {
                const g = eq.gains[i] ?? 0;
                return (
                  <div key={f} className="flex flex-col items-center">
                    <div className="relative flex h-44 w-full items-center justify-center">
                      <input
                        type="range"
                        min={EQ_MIN}
                        max={EQ_MAX}
                        step={0.5}
                        value={g}
                        aria-label={`${fmtHz(f)} Hz`}
                        onChange={(e) => setEqBand(i, parseFloat(e.target.value))}
                        onDoubleClick={() => setEqBand(i, 0)}
                        className="slider slider-v"
                        style={{ ["--p" as string]: `${((g - EQ_MIN) / (EQ_MAX - EQ_MIN)) * 100}%` }}
                      />
                    </div>
                    <div className="mt-2 font-mono text-[10.5px] text-muted tnum">{fmtHz(f)}</div>
                    <div className={cn("font-mono text-[10.5px] tnum", g === 0 ? "text-muted" : "")}>
                      {g > 0 ? `+${g}` : g}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* preamp */}
        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="mb-2 flex items-center justify-between text-[12.5px]">
              <span className="font-medium">{t.preamp}</span>
              <span className="font-mono text-muted tnum">
                {effectivePreamp > 0 ? "+" : ""}
                {effectivePreamp.toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={effectivePreamp}
              disabled={eq.autoGain}
              onChange={(e) => setEqPreamp(parseFloat(e.target.value))}
              className="slider disabled:opacity-50"
              style={{ ["--p" as string]: `${((effectivePreamp + 12) / 24) * 100}%` }}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3 select-none" title={t.autoGainHint}>
            <Toggle checked={eq.autoGain} onChange={setEqAutoGain} />
            <span className="text-[12.5px]">{t.autoGain}</span>
          </label>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">{t.autoGainHint} · ISO 266 · Q = √2</p>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "btn relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-[var(--accent)]" : "bg-[color-mix(in_oklab,var(--fg)_18%,transparent)]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-[var(--ease-spring)] dark:bg-black",
          checked && "translate-x-5",
          checked ? "bg-[var(--accent-fg)]" : "bg-white dark:bg-ink-300",
        )}
      />
    </button>
  );
}
