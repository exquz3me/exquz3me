export default {
  layout: "layouts/post.njk",
  navigation: "blog",
  tags: ["posts", "sitemap"],
  permalink: data => `/blog/${data.page.fileSlug}/`,
};
