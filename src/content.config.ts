import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const leadership = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/leadership" }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    photo: z.string().optional(),
    bio: z.string().optional(),
    email: z.string().email().optional(),
    contactLink: z.string().optional(),
    anchorId: z.string().optional(),
    order: z.number().default(99),
  }),
});

export const collections = { leadership };
