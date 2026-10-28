export function normalizeEditorPath(value = "/editor") {
  if (
    typeof value !== "string" ||
    !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(value)
  ) {
    throw new Error(
      "microbloggr: editorPath must be a path such as /editor or /tools/editor.",
    );
  }
  return value.replace(/\/$/, "");
}

export function withBase(base, path) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export function isEditorPath(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isLoopback(address) {
  return (
    address === "::1" ||
    address === "127.0.0.1" ||
    address === "::ffff:127.0.0.1"
  );
}

export function allowLocalRequest(request) {
  if (!isLoopback(request.socket.remoteAddress)) return false;
  const headers = request.headers;
  if (
    Object.keys(headers).some(
      (key) => key === "forwarded" || key.startsWith("x-forwarded-"),
    )
  )
    return false;
  try {
    const url = new URL(`http://${headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return false;
    if (headers.origin && new URL(headers.origin).host !== url.host)
      return false;
    if (headers["sec-fetch-site"] === "cross-site") return false;
    return true;
  } catch {
    return false;
  }
}
