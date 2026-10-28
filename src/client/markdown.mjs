import { marked } from "marked";
const supported = new Set([
  "space",
  "code",
  "heading",
  "hr",
  "blockquote",
  "list",
  "list_item",
  "paragraph",
  "text",
  "escape",
  "strong",
  "em",
  "codespan",
  "br",
  "del",
  "link",
]);
export function richTextUnavailableReason(source) {
  const tokens = marked.lexer(source);
  let unsupported = Object.keys(tokens.links).length > 0;
  marked.walkTokens(tokens, (token) => {
    if (!supported.has(token.type)) unsupported = true;
    if (token.type === "list_item" && token.task) unsupported = true;
    if (token.type === "code" && /\s/.test(token.lang || ""))
      unsupported = true;
    if (
      token.type === "text" &&
      /[{}]|\[\^|^\s*(?:import|export)\s/m.test(token.text || "")
    )
      unsupported = true;
  });
  return unsupported
    ? "This post uses Markdown that rich text cannot preserve, so it is edited as Markdown."
    : null;
}
export function preserveBodyWhitespace(markdown, original) {
  if (!markdown) return "";
  const ending = /(?:\r?\n)+$/.exec(original)?.[0] ?? "";
  const body = markdown.replace(/(?:\r?\n)+$/, "");
  return `${original.includes("\r\n") ? body.replace(/\r?\n/g, "\r\n") : body}${ending}`;
}
