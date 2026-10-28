import { z } from "astro/zod";

// Copy this file into your project. Add optional fields or defaults here.
// The editor understands the core fields; custom fields do not create form inputs.
const asset = z.string().refine((value) => {
  if (/^\/(?!\/)/.test(value) && !value.includes("\\")) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "Use a site-relative asset path or an HTTP(S) URL.");
const externalUrl = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Use an HTTP(S) URL.");

const common = z.looseObject({
  status: z.enum(["draft", "published"]),
  title: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
  publishedAt: z.coerce.date().nullable().default(null),
  updatedAt: z.coerce.date(),
});

const media = z.object({
  kind: z.enum(["file", "embed"]),
  src: asset,
  poster: asset.optional(),
  /** Player URL the editor resolved from a Bandcamp album or track link. */
  embed: z.string().url().optional(),
});

// Array order is display order. IDs identify photos independently of their URLs.
// Optional IDs keep old files readable; editor saves assign missing IDs.
const photo = z.looseObject({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
    .optional(),
  src: asset.max(10000),
});
const photos = z
  .array(photo)
  .max(100)
  .superRefine((items, context) => {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      if (item.id === undefined) return;
      if (ids.has(item.id))
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Photo IDs must be unique within a post.",
        });
      ids.add(item.id);
    });
  });

export const microblogSchema = z
  .discriminatedUnion("type", [
    common.extend({ type: z.literal("text") }),
    common.extend({
      type: z.literal("photo"),
      photos: photos.optional(),
    }),
    common.extend({
      type: z.literal("link"),
      link: z
        .object({
          url: externalUrl,
        })
        .optional(),
    }),
    common.extend({ type: z.literal("audio"), media: media.optional() }),
    common.extend({ type: z.literal("video"), media: media.optional() }),
  ])
  .superRefine((post, context) => {
    if (post.status !== "published") return;
    const required = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    if (!post.publishedAt)
      required("publishedAt", "Published posts need a publication date.");
    if (post.type === "photo" && !post.photos?.length)
      required("photos", "Published photo posts need an image.");
    if (post.type === "link" && !post.link)
      required("link", "Published link posts need a destination.");
    if ((post.type === "audio" || post.type === "video") && !post.media)
      required("media", "Published media posts need a source.");
  });
