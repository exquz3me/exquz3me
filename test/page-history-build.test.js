/**
 * Exercises modification tracking through clean production Eleventy builds.
 *
 * @file Page history build tests.
 * @author sphoon
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const origin = "https://exquz3.me";

test("clean builds retain history, detect published changes and exclude unpublished posts", () => {
  const work = mkdtempSync(join(tmpdir(), "portfolio-history-"));
  try {
    for (const path of ["src", "lib", "media", "giscus.json", "eleventy.config.js", "package.json"]) {
      cpSync(join(root, path), join(work, path), { recursive: true });
    }
    symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "dir");
    function build() {
      rmSync(join(work, "_site"), { recursive: true, force: true });
      const env = { ...process.env, ELEVENTY_RUN_MODE: "build" };
      delete env.LASTMOD_BASELINE_URL;
      delete env.LASTMOD_USE_DEPLOYED_HISTORY;
      execFileSync(process.execPath, [join(root, "node_modules/@11ty/eleventy/cmd.cjs")], {
        cwd: work, env, stdio: "pipe",
      });
      const history = JSON.parse(readFileSync(join(work, "_site/page-history.json"), "utf8"));
      const sitemap = readFileSync(join(work, "_site/sitemap.xml"), "utf8");
      return { history, sitemap };
    }
    const initial = build();
    assert.equal(initial.history.pages[origin + "/"].lastmod, null);
    assert.deepEqual(build(), initial);
    const posts = join(work, "src/blog/posts");
    writeFileSync(join(posts, "published.md"), '---\ntitle: Published\ndate: 2020-01-01\n---\nFirst version.\n');
    writeFileSync(join(posts, "draft.md"), '---\ntitle: Draft\ndate: 2020-01-01\ndraft: true\n---\nDraft.\n');
    writeFileSync(join(posts, "future.md"), '---\ntitle: Future\ndate: 2099-01-01\n---\nFuture.\n');
    const published = build();
    assert.ok(published.history.pages[origin + "/blog/published/"].lastmod);
    assert.ok(published.history.pages[origin + "/blog/"].lastmod);
    assert.equal(published.history.pages[origin + "/"].lastmod, null);
    assert.equal(published.history.pages[origin + "/blog/draft/"], undefined);
    assert.equal(published.history.pages[origin + "/blog/future/"], undefined);
    assert.match(published.sitemap, /<lastmod>\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(build(), published);
    writeFileSync(join(posts, "published.md"), '---\ntitle: Published\ndate: 2020-01-01\n---\nRevised content.\n');
    const edited = build();
    assert.notEqual(edited.history.pages[origin + "/blog/published/"].fingerprint,
      published.history.pages[origin + "/blog/published/"].fingerprint);
    assert.deepEqual(build(), edited);
    rmSync(join(posts, "published.md"));
    const removed = build();
    assert.equal(removed.history.pages[origin + "/blog/published/"], undefined);
    assert.notEqual(removed.history.pages[origin + "/blog/"].lastmod,
      published.history.pages[origin + "/blog/"].lastmod);
    assert.deepEqual(build(), removed);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
