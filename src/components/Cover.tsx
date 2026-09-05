import { COVER_LIBRARY } from "../lib/covers";
import type { Track } from "../lib/types";
import { cn } from "../utils/cn";

export function coverSrc(track: Track | null): string {
  if (!track) return COVER_LIBRARY[0];
  return track.coverUrl ?? COVER_LIBRARY[track.fallbackCover % COVER_LIBRARY.length];
}

export function Cover({ track, className, rounded = "rounded-2xl" }: { track: Track | null; className?: string; rounded?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-ink-200 dark:bg-ink-800", rounded, className)}>
      <img
        key={coverSrc(track)}
        src={coverSrc(track)}
        alt=""
        draggable={false}
        className="h-full w-full object-cover fade-in select-none"
      />
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10 dark:ring-white/10" />
    </div>
  );
}
