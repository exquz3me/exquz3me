/**
 * Tracks significant rendered page changes against the last published history.
 *
 * Fingerprints cover main content, links, media references, page metadata and
 * structured data. Formatting, styling and shared header/footer text are ignored; links count.
 * Existing pages without a reliable date start undated, rather than receiving
 * an invented modification date. History contains public URLs and hashes only.
 *
 * @file Page modification history.
 * @author sphoon
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { parseDocument } from "htmlparser2";

export const HISTORY_PATH = "page-history.json";
export const LOCAL_HISTORY = ".cache/page-history.json";
const normalize = (text) => text.replace(/\s+/gu, " ").trim();
const ignored = new Set(["script", "style", "svg", "template"]);

function textContent(node) {
  if (node.type === "text") return node.data;
  if (ignored.has(node.name)) return "";
  const text = (node.children ?? []).map(textContent).join("");
  return ["p", "div", "section", "h1", "h2", "h3", "li", "br", "tr"].includes(node.name)
    ? ` ${text} ` : text;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

/** Produces a stable hash of the page's significant, authored HTML content. */
export function fingerprint(content, mediaDigest = () => null) {
  const document = parseDocument(content);
  const parts = [];
  let mainCount = 0;
  function visit(node, inMain = false) {
    const attrs = node.attribs ?? {};
    if (node.name === "title") parts.push(["title", normalize(textContent(node))]);
    if (node.name === "meta" && ["description", "robots"].includes(attrs.name)) {
      parts.push(["meta", attrs.name, attrs.content ?? ""]);
    }
    if (node.name === "link" && attrs.rel === "canonical") parts.push(["canonical", attrs.href]);
    if (node.name === "script" && attrs.type === "application/ld+json") {
      const raw = (node.children ?? []).map((child) => child.data ?? "").join("");
      parts.push(["structured-data", stableJson(JSON.parse(raw))]);
    }
    if (ignored.has(node.name)) return;
    if (node.name === "main") {
      mainCount++;
      parts.push(["main", normalize(textContent(node))]);
      inMain = true;
    }
    if (inMain && node.name === "pre") parts.push(["preformatted", textContent(node).replace(/\r\n/gu, "\n")]);
    if (node.name === "a") parts.push(["link", attrs.href ?? ""]);
    if (inMain && ["img", "video", "audio", "source", "iframe"].includes(node.name)) {
      const references = [attrs.src, attrs.poster].filter(Boolean);
      for (const source of (attrs.srcset ?? "").split(",")) {
        const reference = source.trim().split(/\s+/u)[0];
        if (reference) references.push(reference);
      }
      parts.push([node.name, attrs.src ?? "", attrs.srcset ?? "", attrs.alt ?? "", attrs.title ?? "", attrs.poster ?? "",
        references.map((reference) => [reference, mediaDigest(reference)])]);
    }
    for (const child of node.children ?? []) visit(child, inMain);
  }
  visit(document);
  if (mainCount !== 1) throw new Error("Tracked pages must contain exactly one main element.");
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Rejects incompatible or malformed history rather than silently resetting it. */
export function validateHistory(history, origin, now = new Date()) {
  if (!history || history.version !== 1 || history.origin !== origin || !history.pages || typeof history.pages !== "object" || Array.isArray(history.pages)) {
    throw new Error("Invalid or incompatible page history.");
  }
  for (const [url, page] of Object.entries(history.pages)) {
    if (!page || typeof page !== "object" || new URL(url).origin !== origin || !/^[a-f0-9]{64}$/.test(page.fingerprint)) {
      throw new Error("Invalid page history URL or fingerprint.");
    }
    if (page.lastmod !== null && (
      typeof page.lastmod !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(page.lastmod) ||
      !Number.isFinite(Date.parse(page.lastmod)) ||
      new Date(page.lastmod).toISOString().slice(0, 10) !== page.lastmod.slice(0, 10) ||
      Date.parse(page.lastmod) > now.getTime()
    )) throw new Error("Invalid page history modification date.");
  }
  return history;
}

const runFile = promisify(execFile);

/**
 * Reads a Pages-hosted history directly from its origin, preserving the URL's
 * Host header, TLS server name and certificate verification. Cloudflare's
 * visitor challenges do not need to admit the CI runner. No credentials or
 * redirect following are used; curl's own configuration is disabled.
 */
export async function fetchOriginHistory(url, originHost, run = runFile) {
  if (!/^[a-z0-9-]+\.github\.io$/i.test(originHost)) {
    throw new Error("History origin must be the repository owner's github.io hostname.");
  }
  const { stdout } = await run("curl", [
    "--disable", "--silent", "--show-error", "--proto", "=https",
    "--connect-timeout", "10", "--max-time", "30", "--max-filesize", "5000000",
    "--connect-to", `${url.hostname}:443:${originHost}:443`,
    "--header", "Cache-Control: no-cache", "--write-out", "\\n%{http_code}",
    "--url", url.href,
  ], { timeout: 35000, maxBuffer: 5_100_000 });
  const separator = stdout.lastIndexOf("\n");
  const status = Number(stdout.slice(separator + 1));
  if (separator < 0 || !Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error("Invalid history response from the Pages origin.");
  }
  return new Response(status === 204 || status === 304 ? null : stdout.slice(0, separator), { status });
}

/** Loads local preview history or the history published with the live site. */
export async function loadHistory(origin, remoteUrl, originHost) {
  if (remoteUrl) {
    const url = new URL(remoteUrl);
    if (url.origin !== origin || url.pathname !== `/${HISTORY_PATH}`) {
      throw new Error("Page history must come from the canonical site's history endpoint.");
    }
    url.searchParams.set("build", Date.now().toString());
    const response = originHost ? await fetchOriginHistory(url, originHost) : await fetch(url, {
      redirect: "error",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) {
      console.warn("[lastmod] No published history; establishing a baseline without inventing dates.");
      return null;
    }
    if (!response.ok) throw new Error(`Could not load published page history: HTTP ${response.status}.`);
    const content = await response.text();
    if (Buffer.byteLength(content) > 5_000_000) throw new Error("Page history exceeds the size limit.");
    return validateHistory(JSON.parse(content), origin);
  }
  try {
    return validateHistory(JSON.parse(await readFile(LOCAL_HISTORY, "utf8")), origin);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Preserves dates for unchanged pages and dates observed changes once. */
export function trackPages(pages, baseline, origin, now = new Date()) {
  if (baseline) validateHistory(baseline, origin, now);
  const history = { version: 1, origin, pages: {} };
  for (const page of pages) {
    const hash = fingerprint(page.content, page.mediaDigest);
    const previous = baseline?.pages[page.url];
    let lastmod;
    if (previous?.fingerprint === hash) lastmod = previous.lastmod;
    else if (baseline) lastmod = now.toISOString();
    else lastmod = page.seed ?? null;
    history.pages[page.url] = { fingerprint: hash, lastmod };
  }
  return validateHistory(history, origin, now);
}

const escapeXml = (text) => text.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]);

/** Renders only current public sitemap entries, with trustworthy known dates. */
export function renderSitemap(history) {
  const entries = Object.entries(history.pages).sort(([a], [b]) => a.localeCompare(b));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map(([url, page]) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n` +
      (page.lastmod ? `    <lastmod>${page.lastmod}</lastmod>\n` : "") +
      "  </url>\n").join("") + "</urlset>\n";
}
