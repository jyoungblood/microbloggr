import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { microblogSchema } from "./microblog.schema";

export const collections = {
  microblog: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/microblog" }),
    schema: microblogSchema,
  }),
};
