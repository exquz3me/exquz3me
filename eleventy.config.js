/**
 * Builds the portfolio and Markdown blog into static HTML using shared
 * Nunjucks layouts. Browser scripts and styles are copied to /assets/, while
 * media and hosting configuration retain their published paths.
 *
 * Drafts and future-dated posts are previewed locally and excluded from
 * production builds. Articles require a publication date and are listed
 * newest first. Date filters use UTC for consistent output.
 *
 * Sitemap dates are tracked automatically from significant rendered changes
 * against the last deployed page history. Optional quoted `updated` dates
 * and post publication dates seed the first baseline; unknown dates are
 * omitted. Local preview history is separate from published history.
 * Each deployment owns one canonical origin; links to other projects do not
 * merge their pages or modification history into this site.
 *
 * Use `npm run dev` for a local preview and `npm run build` to generate _site/.
 *
 * @file Eleventy configuration file.
 *
 * @author sphoon
 *
 * @see https://www.11ty.dev/docs/config/
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  HISTORY_PATH, LOCAL_HISTORY, loadHistory, trackPages, renderSitemap,
} from "./lib/page-history.js";
import site from "./src/_data/site.json" with { type: "json" };

const ASSET_PATHS = {
  "src/assets/js": "assets",
  "src/assets/css": "assets",
  media: "media",
};

const HOSTING_FILES = ["giscus.json"];
const POST_COLLECTION = "posts";
const READABLE_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Parses an explicit update date without accepting normalized invalid dates.
 *
 * @param {string} value Quoted front matter date in YYYY-MM-DD format.
 * @param {string} inputPath Source template path for validation errors.
 * @returns {Date} Valid update date at midnight UTC.
 */
function parseUpdatedDate(value, inputPath) {
  const text = value;
  const date = typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(NaN);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${inputPath}: updated must be a valid quoted YYYY-MM-DD date.`);
  }
  if (text > new Date().toISOString().slice(0, 10)) {
    throw new Error(`${inputPath}: updated must not be in the future.`);
  }
  return date;
}

/**
 * Configures site assets, blog posts, and template processing.
 *
 * @param {any} eleventyConfig Eleventy's configuration API.
 * @returns {object} Directory and template settings.
 */
export default function (eleventyConfig) {
  const sitemapPages = new Map();
  const remoteHistory = process.env.LASTMOD_BASELINE_URL ?? (
    process.env.LASTMOD_USE_DEPLOYED_HISTORY === "true"
      ? new URL(HISTORY_PATH, site.url + "/").href
      : undefined
  );
  let baseline;
  eleventyConfig.on("eleventy.before", async () => {
    sitemapPages.clear();
    baseline = await loadHistory(site.url, remoteHistory);
  });
  eleventyConfig.on("eleventy.after", async ({ results, directories, outputMode }) => {
    if (outputMode !== "fs") return;
    const pages = results.filter((page) => sitemapPages.has(page.url)).map((page) => ({
      url: new URL(page.url, site.url).href,
      content: page.content,
      seed: sitemapPages.get(page.url),
      mediaDigest(reference) {
        const url = new URL(reference, new URL(page.url, site.url));
        if (url.origin !== site.url) return null;
        const output = resolve(directories.output);
        const file = resolve(output, "." + decodeURIComponent(url.pathname));
        if (!file.startsWith(output + sep)) throw new Error("Media path escapes the output directory.");
        return createHash("sha256").update(readFileSync(file)).digest("hex");
      },
    }));
    if (pages.length !== sitemapPages.size) throw new Error("Missing rendered sitemap pages.");
    const history = trackPages(pages, baseline, site.url);
    const historyJson = JSON.stringify(history, null, 2) + "\n";
    await mkdir(directories.output, { recursive: true });
    await writeFile(join(directories.output, HISTORY_PATH), historyJson);
    await writeFile(join(directories.output, "sitemap.xml"), renderSitemap(history));
    if (!remoteHistory) {
      await mkdir(".cache", { recursive: true });
      await writeFile(LOCAL_HISTORY, historyJson);
    }
  });
  eleventyConfig.addPassthroughCopy(ASSET_PATHS, {
    filter: ["**", "!**/.gitattributes"],
  });
  for (const file of HOSTING_FILES) {
    eleventyConfig.addPassthroughCopy(file);
  }
  eleventyConfig.addPreprocessor("published-posts", "md", (data) => {
    if (!data.tags?.includes(POST_COLLECTION)) return;

    const date = new Date(data.date);
    if (
      !(data.date instanceof Date || typeof data.date === "string") ||
      !Number.isFinite(date.getTime())
    ) {
      throw new Error(
        `${data.page.inputPath}: articles require a valid publication date in front matter.`,
      );
    }

    if (
      process.env.ELEVENTY_RUN_MODE === "build" &&
      (data.draft || date > new Date())
    ) {
      return false;
    }
  });
  eleventyConfig.addPreprocessor("updated-dates", "md,njk", (data) => {
    if (data.updated === undefined) return;

    const updated = parseUpdatedDate(data.updated, data.page.inputPath);
    if (
      data.tags?.includes(POST_COLLECTION) &&
      updated.toISOString().slice(0, 10) < new Date(data.date).toISOString().slice(0, 10)
    ) {
      throw new Error(`${data.page.inputPath}: updated must not precede publication.`);
    }
    data.updated = updated;
  });
  eleventyConfig.addFilter("sitemapLastmod", (entry, posts = []) => {
    const dates = [];
    if (entry.data.updated) dates.push(new Date(entry.data.updated));
    if (entry.data.tags?.includes(POST_COLLECTION)) {
      dates.push(new Date(entry.data.date));
    } else if (entry.url === "/blog/") {
      for (const post of posts) {
        dates.push(new Date(post.data.updated ?? post.data.date));
      }
    }
    const seed = dates.length
      ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString().slice(0, 10)
      : null;
    sitemapPages.set(entry.url, seed);
    return seed;
  });
  eleventyConfig.addCollection(POST_COLLECTION, (api) =>
    api
      .getFilteredByTag(POST_COLLECTION)
      .sort(
        (a, b) =>
          b.date.getTime() - a.date.getTime() || a.url.localeCompare(b.url),
      ),
  );
  eleventyConfig.addFilter("isoDate", (date) =>
    new Date(date).toISOString().slice(0, 10),
  );
  eleventyConfig.addFilter("readableDate", (date) =>
    READABLE_DATE_FORMATTER.format(new Date(date)),
  );
  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md"],
    markdownTemplateEngine: false,
  };
}
