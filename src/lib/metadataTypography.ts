import type { CSSProperties } from "react";

// Conservative script hints, not a general language detector. Ambiguous names
// keep the UI default; kana takes precedence. Apply to the WHOLE metadata field
// so simplified-only glyphs cannot fall back to a different weight mid-name.
const simplifiedChinese = /[罗汉语简乐门风龙爱书车东专辑网这们听说话谁欢观广岛鸟乡梦见贝页时钟线红绿蓝]/u;
const kana = /[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]/u;
export function metadataTypography(text: string | null | undefined): { lang?: string; style?: CSSProperties } {
  if (!text) return {};
  if (kana.test(text)) return { lang: "ja", style: { fontFamily: "var(--font-ja)" } };
  if (simplifiedChinese.test(text)) return { lang: "zh-CN", style: { fontFamily: "var(--font-zh)" } };
  return {};
}
