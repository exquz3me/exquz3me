export default {
  layout: "layouts/post.njk",
  navigation: "blog",
  tags: ["posts"],
  permalink: data => `/blog/${data.page.fileSlug}/`,
};
