// Only accept returns to this editor's feed, archive, or a post's detail page,
// never an external redirect.
export function editorReturn(value, editorUrl) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("\\")
  )
    return undefined;
  try {
    const url = new URL(value, "http://microbloggr.local");
    const path = url.pathname;
    if (
      url.origin === "http://microbloggr.local" &&
      (path === editorUrl ||
        path === `${editorUrl}/` ||
        path === `${editorUrl}/archive` ||
        (path.startsWith(`${editorUrl}/posts/`) &&
          /^[^/]+$/.test(path.slice(`${editorUrl}/posts/`.length))))
    )
      return `${path}${url.search}`;
  } catch {}
  return undefined;
}
