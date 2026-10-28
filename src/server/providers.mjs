import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { providerEmbed } from "../embeds.mjs";

// Server-side provider lookups, run only when a post is saved.
// Images download only from fixed provider CDNs, never via redirects.
const imageHost = (host) =>
  ["i.ytimg.com", "i.vimeocdn.com"].includes(host) ||
  host.endsWith(".sndcdn.com") ||
  host.endsWith(".bcbits.com");
const maxBytes = 10 * 1024 ** 2;
const timeout = () => AbortSignal.timeout(8000);

async function download(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !imageHost(url.hostname)) return null;
  const response = await fetch(url, { signal: timeout(), redirect: "error" });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length && bytes.length <= maxBytes ? bytes : null;
}

async function oembedImage(endpoint, source, params = {}) {
  const api = new URL(endpoint);
  for (const [key, value] of Object.entries({ url: source, ...params }))
    api.searchParams.set(key, value);
  const response = await fetch(api, { signal: timeout(), redirect: "error" });
  if (!response.ok) return null;
  const { thumbnail_url: image } = await response.json();
  return typeof image === "string" ? image : null;
}

// The page's Open Graph image, read only from the expected provider host.
async function pageImage(source, allowed) {
  const response = await fetch(source, { signal: timeout() });
  if (!response.ok || !allowed(new URL(response.url).hostname)) return null;
  const page = (await response.text()).slice(0, 2 * 1024 ** 2);
  return (
    /<meta\s+property="og:image"\s+content="([^"]+)"/.exec(page)?.[1] ?? null
  );
}

/**
 * Downloads a provider's thumbnail or artwork for an embedded media link:
 * YouTube and Vimeo videos, SoundCloud and Bandcamp audio.
 * Returns image bytes, or null when the provider is unknown or unreachable.
 * @param {string} source
 * @param {"audio" | "video"} [type]
 */
export async function providerThumbnail(source, type = "video") {
  try {
    if (type === "audio") {
      if (bandcampPage(source)) {
        const image = await pageImage(source, bandcampHost);
        return image ? await download(image) : null;
      }
      const embed = providerEmbed(source, "audio");
      if (embed?.provider !== "SoundCloud") return null;
      const image = await oembedImage(
        "https://soundcloud.com/oembed",
        embed.href,
        {
          format: "json",
        },
      );
      return image ? await download(image) : null;
    }
    const embed = providerEmbed(source, "video");
    if (embed?.provider === "YouTube") {
      const id = new URL(embed.href).searchParams.get("v");
      // maxresdefault is missing for some videos; hqdefault always exists.
      for (const size of ["maxresdefault", "hqdefault"]) {
        const bytes = await download(
          `https://i.ytimg.com/vi/${id}/${size}.jpg`,
        ).catch(() => null);
        if (bytes) return bytes;
      }
      return null;
    }
    if (embed?.provider === "Vimeo") {
      const image =
        (await oembedImage("https://vimeo.com/api/oembed.json", embed.href, {
          width: "1280",
        })) ??
        // Some owners disable oEmbed; the public page still lists its image.
        (await pageImage(embed.href, (host) => host === "vimeo.com"));
      // Drop the query (format/region hints); the CDN serves a JPEG.
      return image ? await download(decode(image).split("?")[0]) : null;
    }
  } catch {
    /* Offline or blocked: save the post without a thumbnail. */
  }
  return null;
}

const bandcampHost = (host) => host.endsWith(".bandcamp.com");
const decode = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Album and track pages on an artist's bandcamp.com subdomain. */
export function bandcampPage(source) {
  try {
    const url = new URL(source);
    return (
      url.protocol === "https:" &&
      bandcampHost(url.hostname) &&
      /^\/(?:album|track)\/[\w-]+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Bandcamp page links carry no player ID; the page's metadata does.
 * Returns an EmbeddedPlayer URL, or null when the page can't be read.
 * @param {string} source
 */
export async function bandcampPlayer(source) {
  if (!bandcampPage(source)) return null;
  try {
    const response = await fetch(source, { signal: timeout() });
    if (!response.ok || !bandcampHost(new URL(response.url).hostname))
      return null;
    const page = (await response.text()).slice(0, 2 * 1024 ** 2);
    const meta = /<meta\s+name="bc-page-properties"\s+content="([^"]+)"/.exec(
      page,
    )?.[1];
    if (!meta) return null;
    const { item_type: kind, item_id: id } = JSON.parse(decode(meta));
    const key = { a: "album", t: "track" }[kind];
    if (!key || !Number.isSafeInteger(id) || id < 1) return null;
    const player = `https://bandcamp.com/EmbeddedPlayer/${key}=${id}/`;
    return providerEmbed(player, "audio") ? player : null;
  } catch {
    return null;
  }
}

// Loopback, private, and link-local addresses are refused so a pasted URL
// cannot reach services on this machine or its network.
function privateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb")
  );
}
async function publicUrl(url) {
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use an http or https link.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(privateAddress))
    throw new Error("Links to local or private addresses are not allowed.");
}

/**
 * Downloads a media file from a pasted link, following at most five
 * redirects and stopping at `limit` bytes.
 * @param {string} source
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
export async function downloadMedia(source, limit) {
  let url = new URL(source);
  const signal = AbortSignal.timeout(60000);
  for (let hops = 0; hops <= 5; hops++) {
    await publicUrl(url);
    const response = await fetch(url, { signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) break;
      url = new URL(next, url);
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error(`The link returned ${response.status}.`);
    if (Number(response.headers.get("content-length")) > limit)
      throw new Error("The file is larger than the upload limit.");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit)
        throw new Error("The file is larger than the upload limit.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("The link redirected too many times.");
}
