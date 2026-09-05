import c1 from "../assets/covers/cover-1.jpg";
import c2 from "../assets/covers/cover-2.jpg";
import c3 from "../assets/covers/cover-3.jpg";
import c4 from "../assets/covers/cover-4.jpg";
import c5 from "../assets/covers/cover-5.jpg";
import c6 from "../assets/covers/cover-6.jpg";

/** A small curated library of 2D illustrated covers used when a file has no embedded artwork. */
export const COVER_LIBRARY = [c1, c2, c3, c4, c5, c6];

/** Deterministic hash so the same file always gets the same fallback cover. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickFallbackCover(seed: string): number {
  return hashString(seed) % COVER_LIBRARY.length;
}
