/**
 * Builds the portfolio and Markdown blog into static HTML using shared
 * Nunjucks layouts. Browser scripts and styles are copied to /assets/, while
 * media and hosting configuration retain their published paths.
 *
 * Drafts and future-dated posts are previewed locally and excluded from
 * production builds. Articles require a publication date and are listed
 * newest first. Date filters use UTC for consistent output.
 *
 * Use `npm run dev` for a local preview and `npm run build` to generate _site/.
 *
 * @file Eleventy configuration file.
 *
 * @author sphoon
 *
 * @see https://www.11ty.dev/docs/config/
 */

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
 * Configures site assets, blog posts, and template processing.
 *
 * @param {any} eleventyConfig Eleventy's configuration API.
 * @returns {object} Directory and template settings.
 */
export default function (eleventyConfig) {
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
