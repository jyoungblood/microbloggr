import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
export function safeUrl(value, base = "/") {
  if (!value) return undefined;
  if (/^\/(?!\/)/.test(value) && !value.includes("\\"))
    return `${base.replace(/\/$/, "")}${value}`;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function markdown(body, base = "/") {
  return sanitizeHtml(marked.parse(body, { async: false }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "title", "loading"],
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
    transformTags: {
      img: (_tag, attributes) => ({
        tagName: "img",
        attribs: {
          ...attributes,
          src: safeUrl(attributes.src, base) || "",
          loading: "lazy",
        },
      }),
    },
  });
}
