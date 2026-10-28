import type { CollectionEntry } from "astro:content";
import { safeUrl } from "./render.mjs";
export { safeUrl, markdown } from "./render.mjs";

export type Post = CollectionEntry<"microblog">;
export const types = ["text", "photo", "link", "audio", "video"] as const;
export type PostType = (typeof types)[number];
export function dateOf(post: Post): Date {
  return post.data.publishedAt ?? post.data.createdAt;
}
export function newestFirst(a: Post, b: Post) {
  return dateOf(b).getTime() - dateOf(a).getTime() || a.id.localeCompare(b.id);
}
export function dateLabel(date: Date, monthOnly = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: monthOnly ? "long" : "short",
    ...(monthOnly ? {} : { day: "numeric" as const }),
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
export function excerpt(post: Post) {
  return (post.body || "").replace(/[#*_>`\[\]]/g, "").slice(0, 220);
}
export function cover(post: Post, base = "/") {
  if (post.data.type === "photo")
    return safeUrl(post.data.photos?.[0]?.src, base);
  if (post.data.type === "video" || post.data.type === "audio")
    return safeUrl(post.data.media?.poster, base);
}
