import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const port = Number(process.env.FONT_CHECK_PORT || 5211);
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  cacheDir: path.join(os.tmpdir(), `lumen-font-check-${process.pid}`),
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const lang of ["zh", "en", "ja"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript((value) => localStorage.setItem("lumen.lang", value), lang);
    const page = await context.newPage();
    await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('.lang-switcher-indicator').waitFor();
    const result = await page.evaluate(async () => {
      await document.fonts.ready;
      const root = document.documentElement;
      const body = getComputedStyle(document.body);
      const indicator = document.querySelector(".lang-switcher-indicator")?.getBoundingClientRect();
      const activeOption = document.querySelector('[aria-checked="true"]')?.getBoundingClientRect();
      const progressSlider = document.querySelector("input[type=range]")?.getBoundingClientRect();
      const probe = document.createElement("span");
      probe.textContent = "Русский Doosan 123 中文 日本語";
      probe.style.cssText = 'position:absolute;visibility:hidden;font:500 16px "Geist Variable"';
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return {
        lang: root.dataset.lang,
        family: body.fontFamily,
        geistLoaded: document.fonts.check('500 16px "Geist Variable"'),
        width,
        hasInterFeature: body.fontFeatureSettings.includes("cv11") || body.fontFeatureSettings.includes("ss01"),
        indicator,
        activeOption,
        progressSlider,
      };
    });
    assert.equal(result.lang, lang);
    assert(result.geistLoaded, `${lang}: Geist did not load`);
    assert(result.width > 100, `${lang}: probe did not render`);
    assert.equal(result.hasInterFeature, false, `${lang}: Inter-only features remain`);
    assert(result.indicator && result.activeOption, `${lang}: language switcher is missing`);
    assert(Math.abs(result.indicator.left - result.activeOption.left) < 1.5, `${lang}: language indicator is horizontally misaligned`);
    assert(Math.abs(result.indicator.width - result.activeOption.width) < 1.5, `${lang}: language indicator width is wrong`);
    assert(result.progressSlider && result.progressSlider.height >= 6, `${lang}: progress slider hit area is too small`);
    await context.close();
    console.log(`PASS font ${lang}: ${result.family}`);
  }
} finally {
  await browser.close();
  await server.close();
}
