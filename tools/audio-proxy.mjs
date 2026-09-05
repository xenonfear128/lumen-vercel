#!/usr/bin/env node
/*
 * Optional CORS audio relay for NetEase online tracks.
 *
 * NetEase's audio CDN (`*.music.126.net`) currently sends `Access-Control-Allow-Origin: *`,
 * so Lumen plays online tracks directly and this proxy is not required — but it's kept as a
 * fallback in case the CDN ever stops sending CORS headers.
 *
 * How to use:
 *   node tools/audio-proxy.mjs            # listens on :5174
 *   AUDIO_PROXY_PORT=8080 node tools/audio-proxy.mjs
 * Then set "Audio proxy" in Lumen → Online music settings to http://localhost:5174
 *
 * Requests must include the upstream URL explicitly: http://localhost:5174?url=<encoded>
 * Only NetEase CDN hosts are allowed. Range requests are forwarded so seeking keeps working.
 */
import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.AUDIO_PROXY_PORT || 5174);

// Upstream host allowlist — only NetEase's media CDNs. Everything else is refused.
const ALLOWED_HOSTS = /(^|\.)(music\.126\.net|126\.net)$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "Range,If-Range,Content-Type",
  "Access-Control-Expose-Headers": "Content-Range,Accept-Ranges,Content-Length,Content-Type,Content-Disposition",
  "Access-Control-Max-Age": "86400",
};

const FORWARD = ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "last-modified", "etag"];

function sanitizeUrl(raw) {
  try {
    const u = new URL(decodeURIComponent(raw));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!ALLOWED_HOSTS.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

async function relay(target, headers, res) {
  const mod = target.protocol === "https:" ? https : http;
  // Follow up to 3 redirects (CDN may bounce to a specific edge host).
  let url = target;
  for (let hop = 0; hop < 3; hop++) {
    const status = await new Promise((resolve, reject) => {
      const rq = mod.request(url, { method: "GET", headers }, (or) => {
        if (or.statusCode >= 300 && or.statusCode < 400 && or.headers.location) {
          or.resume();
          resolve({ redirect: or.headers.location });
          return;
        }
        resolve({ response: or });
      });
      rq.on("error", reject);
      rq.end();
    });
    if (status.redirect) {
      const next = new URL(status.redirect, url);
      if (!ALLOWED_HOSTS.test(next.hostname)) {
        res.writeHead(400, CORS);
        res.end("redirect to disallowed host");
        return;
      }
      url = next;
      continue;
    }
    const or = status.response;
    const h = { ...CORS };
    for (const k of FORWARD) {
      const v = or.headers[k];
      if (v !== undefined) h[k] = v;
    }
    res.writeHead(or.statusCode || 200, h);
    or.pipe(res);
    or.on("error", () => res.destroy());
    return;
  }
  res.writeHead(400, CORS);
  res.end("too many redirects");
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const target = sanitizeUrl(u.searchParams.get("url") || "");
  if (!target) {
    res.writeHead(400, CORS);
    res.end(`bad or disallowed url`);
    return;
  }
  const headers = {};
  if (req.headers.range) headers["Range"] = req.headers.range;
  headers["User-Agent"] = req.headers["user-agent"] || "Mozilla/5.0";
  relay(target, headers, res).catch(() => {
    if (!res.headersSent) {
      res.writeHead(502, CORS);
      res.end("proxy upstream error");
    } else {
      res.destroy();
    }
  });
});

server.listen(PORT, () => {
  console.log(`[audio-proxy] listening on http://localhost:${PORT}`);
});
