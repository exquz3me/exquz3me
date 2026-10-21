/**
 * Verifies automatic modification dates and significant-content detection.
 *
 * @file Page history tests.
 * @author sphoon
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fingerprint, trackPages, validateHistory, renderSitemap, loadHistory } from "../lib/page-history.js";

const origin = "https://exquz3.me";
const first = new Date("2026-01-01T00:00:00.000Z");
const next = new Date("2026-01-02T00:00:00.000Z");
const html = (body = "Hello", extra = "") => `<!doctype html><html><head><title>Title</title>
  <meta name="description" content="Description">${extra}</head><body>
  <header>Navigation</header><main><p>${body}</p></main><footer>2026</footer></body></html>`;
const page = (content = html(), path = "/", seed = null) => ({ url: origin + path, content, seed });

test("bootstrap preserves known seed dates and leaves unknown historical dates absent", () => {
  const history = trackPages([page(), page(html("Post"), "/blog/post/", "2025-12-01")], null, origin, first);
  assert.equal(history.pages[origin + "/"].lastmod, null);
  assert.equal(history.pages[origin + "/blog/post/"].lastmod, "2025-12-01");
  assert.equal((renderSitemap(history).match(/<lastmod>/g) ?? []).length, 1);
});

test("unchanged builds preserve dates, including unknown dates and old explicit seeds", () => {
  const pages = [page(), page(html("Post"), "/blog/post/", "2025-12-01")];
  const baseline = trackPages(pages, null, origin, first);
  assert.deepEqual(trackPages(pages, baseline, origin, next), baseline);
});

test("content edits, additions and removals update only affected current entries", () => {
  const baseline = trackPages([page(), page(html("Old"), "/removed/")], null, origin, first);
  const history = trackPages([page(html("Updated")), page(html("New"), "/new/")], baseline, origin, next);
  assert.equal(history.pages[origin + "/"].lastmod, next.toISOString());
  assert.equal(history.pages[origin + "/new/"].lastmod, next.toISOString());
  assert.equal(history.pages[origin + "/removed/"], undefined);
  assert.deepEqual(trackPages([page(html("Updated")), page(html("New"), "/new/")], history, origin, next), history);
});

test("markup formatting, classes, comments, footer years and CSS do not advance dates", () => {
  const before = html("Hello <strong>world</strong>");
  const after = html("Hello <span class='new'>world</span>", "<style>body { color: red; }</style>")
    .replace("<p>", "<!-- comment -->\n<p class='new'>")
    .replace("<footer>2026", "<footer>2027");
  assert.equal(fingerprint(before), fingerprint(after));
});

test("links, media, title and description changes affect fingerprints", () => {
  assert.notEqual(fingerprint(html('<a href="/a">Link</a>')), fingerprint(html('<a href="/b">Link</a>')));
  assert.notEqual(fingerprint(html('<img src="/a.png" alt="A">')), fingerprint(html('<img src="/b.png" alt="A">')));
  assert.notEqual(fingerprint(html()), fingerprint(html().replace("<title>Title", "<title>Other")));
  assert.notEqual(fingerprint(html()), fingerprint(html().replace('content="Description"', 'content="Other"')));
});

test("same-URL local media replacements and shared navigation links count", () => {
  const content = html('<img src="/media/photo.png" alt="Photo">');
  assert.notEqual(fingerprint(content, () => "old-bytes"), fingerprint(content, () => "new-bytes"));
  assert.notEqual(fingerprint(html().replace("Navigation", '<a href="/a">Nav</a>')),
    fingerprint(html().replace("Navigation", '<a href="/b">Nav</a>')));
});

test("meaningful preformatted code whitespace counts", () => {
  assert.notEqual(fingerprint(html("<pre>  code</pre>")), fingerprint(html("<pre>    code</pre>")));
});

test("structured data changes count, but JSON whitespace and key order do not", () => {
  const structured = (json) => html("Hello", `<script type="application/ld+json">${json}</script>`);
  assert.equal(fingerprint(structured('{"a":1,"b":2}')), fingerprint(structured('{ "b": 2, "a": 1 }')));
  assert.notEqual(fingerprint(structured('{"a":1}')), fingerprint(structured('{"a":2}')));
  assert.throws(() => fingerprint(structured("broken")));
});

test("invalid, incompatible, cross-site and future-dated history fails validation", () => {
  const baseline = trackPages([page()], null, origin, first);
  for (const bad of [
    { ...baseline, version: 2 },
    { ...baseline, origin: "https://other.example" },
    { ...baseline, pages: { "https://other.example/": Object.values(baseline.pages)[0] } },
    { ...baseline, pages: { [origin + "/"]: { fingerprint: "bad", lastmod: null } } },
    { ...baseline, pages: { [origin + "/"]: { ...Object.values(baseline.pages)[0], lastmod: "2099-01-01" } } },
  ]) assert.throws(() => validateHistory(bad, origin, first));
  assert.throws(() => fingerprint("<html><body>No main element</body></html>"));
});

test("sitemap entries are sorted and XML escaped", () => {
  const history = trackPages([page(html(), "/z/?a=1&b=2"), page()], null, origin, first);
  const xml = renderSitemap(history);
  assert.match(xml, /a=1&amp;b=2/);
  assert.ok(xml.indexOf(`<loc>${origin}/</loc>`) < xml.indexOf("/z/"));
});

test("published-history HTTP errors fail closed; only missing history bootstraps", async (t) => {
  const history = trackPages([page()], null, origin, first);
  const url = origin + "/page-history.json";
  const mocked = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(history)));
  assert.deepEqual(await loadHistory(origin, url), history);
  mocked.mock.mockImplementation(async () => new Response("Missing", { status: 404 }));
  assert.equal(await loadHistory(origin, url), null);
  mocked.mock.mockImplementation(async () => new Response("Denied", { status: 403 }));
  await assert.rejects(loadHistory(origin, url), /HTTP 403/);
  mocked.mock.mockImplementation(async () => new Response("invalid JSON"));
  await assert.rejects(loadHistory(origin, url));
  await assert.rejects(loadHistory(origin, "https://other.example/page-history.json"));
});


test("hub links do not merge subdomain pages or histories", () => {
  const content = html('<a href="https://example.exquz3.me/">Example project</a>');
  const hub = trackPages([page(content)], null, origin, first);
  assert.deepEqual(Object.keys(hub.pages), [origin + "/"]);
  assert.doesNotMatch(renderSitemap(hub), /example\.exquz3\.me/);
  const projectOrigin = "https://example.exquz3.me";
  const project = trackPages([{ url: projectOrigin + "/", content: html("Project") }], null, projectOrigin, first);
  assert.throws(() => trackPages([page(content)], project, origin, next));
  assert.throws(() => trackPages([{ url: projectOrigin + "/", content }], hub, origin, next));
  assert.deepEqual(trackPages([page(content)], hub, origin, next), hub);
  const changedLink = content.replace("example.exquz3.me", "another.exquz3.me");
  assert.equal(trackPages([page(changedLink)], hub, origin, next).pages[origin + "/"].lastmod, next.toISOString());
});
