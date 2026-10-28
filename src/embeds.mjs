// Editor-only adapters. Never pass through provider HTML or player parameters.
function externalUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 10000 ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url
      : null;
  } catch {
    return null;
  }
}

/** @param {string} source @param {string} type */
export function providerEmbed(source, type) {
  const url = externalUrl(source);
  if (!url) return null;
  const host = url.hostname;
  const path = url.pathname.replace(/\/$/, "");
  const player = (provider, src, layout, height, href = url.href) => ({
    provider,
    src,
    layout,
    height,
    href,
  });
  if (type === "video") {
    let id;
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
      ].includes(host)
    ) {
      id =
        path === "/watch"
          ? url.searchParams.get("v")
          : /^\/(?:embed|shorts|live)\/([\w-]+)$/.exec(path)?.[1];
    } else if (host === "youtu.be") id = /^\/([\w-]+)$/.exec(path)?.[1];
    if (id && /^[\w-]{11}$/.test(id))
      return player(
        "YouTube",
        `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&playsinline=1`,
        "video",
        315,
        `https://www.youtube.com/watch?v=${id}`,
      );

    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
      const match =
        host === "player.vimeo.com"
          ? /^\/video\/([1-9]\d{0,11})$/.exec(path)
          : /^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/)?([1-9]\d{0,11})(?:\/([a-zA-Z0-9]+))?$/.exec(
              path,
            );
      if (match) {
        const hash = match[2] || url.searchParams.get("h");
        if (hash && !/^[a-zA-Z0-9]{1,64}$/.test(hash)) return null;
        const params = new URLSearchParams();
        if (hash) params.set("h", hash);
        params.set("autoplay", "0");
        return player(
          "Vimeo",
          `https://player.vimeo.com/video/${match[1]}?${params}`,
          "video",
          315,
          `https://vimeo.com/${match[1]}${hash ? `/${hash}` : ""}`,
        );
      }
    }
  }
  if (type === "audio") {
    const soundcloud =
      ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(
        host,
      ) &&
      /^\/[\w-]+\/(?:sets\/[\w-]+|[\w-]+)(?:\/s-[\w-]+)?$/.test(path) &&
      !/^\/(?:discover|search|you|stations|stream|charts)\//.test(path);
    const soundcloudApi =
      host === "api.soundcloud.com" &&
      /^\/(?:tracks|playlists)\/[1-9]\d*$/.test(path);
    if (soundcloud || soundcloudApi) {
      const track = new URL(
        `https://${soundcloud ? "soundcloud.com" : host}${path}`,
      );
      const secret = url.searchParams.get("secret_token");
      if (secret && /^s-[\w-]+$/.test(secret))
        track.searchParams.set("secret_token", secret);
      const params = new URLSearchParams({
        url: track.href,
        auto_play: "false",
        visual: "false",
      });
      return player(
        "SoundCloud",
        `https://w.soundcloud.com/player/?${params}`,
        "audio",
        path.includes("/sets/") || path.startsWith("/playlists/") ? 450 : 166,
        track.href,
      );
    }
    if (host === "bandcamp.com" && path.startsWith("/EmbeddedPlayer/")) {
      const segments = path.slice("/EmbeddedPlayer/".length).split("/");
      const ids = [];
      for (const key of ["album", "track"]) {
        const matches = segments.filter((segment) =>
          segment.startsWith(`${key}=`),
        );
        if (
          matches.length > 1 ||
          (matches.length &&
            !new RegExp(`^${key}=[1-9]\\d{0,11}$`).test(matches[0]))
        )
          return null;
        if (matches.length) ids.push(matches[0]);
      }
      if (ids.length) {
        // Bandcamp's standard player starts paused; discard all supplied options.
        const src = `https://bandcamp.com/EmbeddedPlayer/${ids.join("/")}/size=large/bgcol=202025/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/`;
        return player("Bandcamp", src, "audio", 120, src);
      }
    }
  }
  return null;
}

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );

/** Shared by saved feed cards and detail pages. */
export function renderProvider(source, type) {
  const url = externalUrl(source);
  if (!url) return "";
  const embed = providerEmbed(source, type);
  // A working player stands alone; a link is only the fallback.
  if (embed)
    return `<div class="provider-preview"><iframe class="provider-player provider-player-${embed.layout}" src="${escape(embed.src)}" title="${escape(embed.provider)} ${type} player" width="100%" height="${embed.height}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay 'none'; fullscreen; picture-in-picture; encrypted-media"${type === "video" ? " allowfullscreen" : ""}></iframe></div>`;
  return `<div class="provider-preview"><div class="provider-fallback"><a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">Open ${escape(url.hostname)} ↗</a><p>Playback is unavailable for this link.</p></div></div>`;
}
