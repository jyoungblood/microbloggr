import { randomUUID, createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import { fileTypeFromBuffer } from "file-type";
import {
  bandcampPage,
  bandcampPlayer,
  downloadMedia,
  providerThumbnail,
} from "./providers.mjs";
import { providerEmbed } from "../embeds.mjs";

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const types = ["text", "photo", "link", "audio", "video"];
const locks = new Map();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw new InputError(message);
};
const string = (value, label, max = 10000) => {
  if (typeof value !== "string" || value.length > max)
    fail(`${label} must be text, at most ${max} characters.`);
  return value;
};
function date(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail(`${label} must be an ISO timestamp.`);
  return new Date(value).toISOString();
}
function url(value, label, external = false) {
  string(value, label);
  if (!external && /^\/(?!\/)/.test(value) && !value.includes("\\"))
    return value;
  try {
    if (["http:", "https:"].includes(new URL(value).protocol)) return value;
  } catch {}
  fail(
    `${label} must be ${external ? "an HTTP(S) URL" : "a site-relative path or HTTP(S) URL"}.`,
  );
}
export function normalizeTags(tags) {
  if (!Array.isArray(tags) || tags.length > 100) fail("Use at most 100 tags.");
  const seen = new Set();
  return tags
    .map((tag) => string(tag, "Tag", 100).trim())
    .filter((tag) => {
      if (!tag || seen.has(tag.toLocaleLowerCase())) return false;
      seen.add(tag.toLocaleLowerCase());
      return true;
    });
}
function validatePhotos(photos) {
  if (!Array.isArray(photos) || photos.length > 100)
    fail("Photos must be an array with at most 100 entries.");
  const ids = new Set();
  for (const photo of photos) {
    if (!record(photo)) fail("Invalid photo.");
    if (photo.id !== undefined) {
      if (
        typeof photo.id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(photo.id)
      )
        fail(
          "Invalid photo ID. Use 1–128 letters, digits, underscores or hyphens, starting with a letter or digit.",
        );
      if (ids.has(photo.id)) fail("Photo IDs must be unique within a post.");
      ids.add(photo.id);
    }
    url(photo.src, "Photo");
  }
}

function mergePhotos(previous, photos) {
  validatePhotos(photos);
  return photos.map((photo) => {
    // Never merge by position: reorder/removal must not transfer metadata.
    const matches = previous.filter((old) =>
      photo.id === undefined ? old.src === photo.src : old.id === photo.id,
    );
    if (matches.length > 1)
      fail("This photo source has multiple matches. Supply a unique photo ID.");
    const old = matches[0];
    const merged = {
      ...old,
      ...photo,
      id: photo.id ?? old?.id ?? randomUUID(),
    };
    // Alternative text is not edited for now; older posts drop it on save.
    delete merged.alt;
    delete merged.decorative;
    return merged;
  });
}

export function validate(data, body) {
  if (!record(data) || !types.includes(data.type))
    fail("Choose a valid post type.");
  if (!["draft", "published"].includes(data.status))
    fail("Choose draft or published.");
  string(body, "Markdown", 1000000);
  if (data.title !== undefined) string(data.title, "Title", 500);
  data.tags = normalizeTags(data.tags ?? []);
  data.createdAt = date(data.createdAt, "Created date");
  data.updatedAt = date(data.updatedAt, "Updated date");
  data.publishedAt =
    data.publishedAt == null
      ? null
      : date(data.publishedAt, "Publication date");
  if (data.type === "photo" && data.photos !== undefined)
    validatePhotos(data.photos);
  if (data.type === "link" && data.link !== undefined) {
    if (!record(data.link)) fail("Invalid link.");
    url(data.link.url, "Destination", true);
    // Older posts may carry these; the post body now describes the link.
    delete data.link.description;
    delete data.link.image;
  }
  if (["audio", "video"].includes(data.type) && data.media !== undefined) {
    if (!record(data.media) || !["file", "embed"].includes(data.media.kind))
      fail("Choose a media source kind.");
    url(data.media.src, "Media source", data.media.kind === "embed");
    if (data.media.poster === "") delete data.media.poster;
    if (data.media.poster !== undefined) url(data.media.poster, "Poster");
    if (
      data.media.embed !== undefined &&
      !(
        typeof data.media.embed === "string" &&
        data.media.embed.startsWith("https://bandcamp.com/EmbeddedPlayer/") &&
        providerEmbed(data.media.embed, data.type)
      )
    )
      fail("Embedded player must be a Bandcamp EmbeddedPlayer URL.");
  }
  if (data.status === "published") {
    if (!data.publishedAt) fail("Published posts need a publication date.");
    if (data.type === "text" && !body.trim())
      fail("Write something before publishing.");
    if (data.type === "photo" && !data.photos?.length)
      fail("Add a photo before publishing.");
    if (data.type === "link" && !data.link)
      fail("Add a destination before publishing.");
    if (["audio", "video"].includes(data.type) && !data.media)
      fail("Add a media source before publishing.");
  }
  return data;
}
export function parsePost(raw, id) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) fail("Missing YAML frontmatter.");
  const document = parseDocument(match[1], {
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length || document.warnings.length)
    fail("Invalid YAML frontmatter. Check the file in your code editor.");
  const data = document.toJS({ maxAliasCount: 50 });
  const body = raw.slice(match[0].length);
  validate(data, body);
  return { id, data, body, revision: hash(raw) };
}
function relative(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    path.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail(`${label} must be a relative directory without traversal.`);
  return value;
}
async function serial(key, operation) {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}
export function createStore({
  root,
  publicDir,
  contentDir = "src/content/microblog",
  mediaDir = "assets/microblog",
  uploadLimits = {},
  providerLookups = true,
  // Tests inject fakes; the editor uses the real provider lookups.
  fetchThumbnail = providerThumbnail,
  fetchPlayer = bandcampPlayer,
  fetchMedia = downloadMedia,
}) {
  relative(contentDir, "contentDir");
  relative(mediaDir, "mediaDir");
  const limits = {
    photo: 20 * 1024 ** 2,
    audio: 100 * 1024 ** 2,
    video: 100 * 1024 ** 2,
    ...uploadLimits,
  };
  for (const type of ["photo", "audio", "video"])
    if (
      !Number.isSafeInteger(limits[type]) ||
      limits[type] < 1 ||
      limits[type] > 1024 ** 3
    )
      fail("Upload limits must be between 1 byte and 1 GiB.");
  // Generated video thumbnails share the photo rules but live apart, so a
  // later save can tell them from posters the author chose.
  limits.thumbnail = limits.photo;
  const thumbnailPath = `/${mediaDir}/thumbnails/`;
  const generated = (poster) =>
    typeof poster === "string" && poster.startsWith(thumbnailPath);
  // Check every existing path segment. Never follow a content, upload, or trash symlink.
  async function checked(base, rel, create = false) {
    let cursor = await realpath(base);
    const pieces = relative(rel, "Path").split("/");
    for (const [index, piece] of pieces.entries()) {
      cursor = path.join(cursor, piece);
      let info;
      try {
        info = await lstat(cursor);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (create && index < pieces.length - 1) {
          await mkdir(cursor).catch((error) => {
            if (error.code !== "EEXIST") throw error;
          });
          info = await lstat(cursor);
        }
      }
      if (info?.isSymbolicLink())
        fail("Symlinks are not supported for editor files.");
      if (info && index < pieces.length - 1 && !info.isDirectory())
        fail("A parent path is not a directory.");
    }
    return cursor;
  }
  function idCheck(id) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))
      fail("Invalid post ID.");
  }
  async function filename(id, create = false) {
    idCheck(id);
    return checked(root, `${contentDir}/${id}.md`, create);
  }
  async function get(id) {
    try {
      return parsePost(await readFile(await filename(id), "utf8"), id);
    } catch (error) {
      if (error.code === "ENOENT") throw new InputError("Post not found.", 404);
      throw error;
    }
  }
  async function list() {
    const posts = [],
      errors = [];
    let entries;
    try {
      entries = await readdir(await checked(root, contentDir));
    } catch (error) {
      if (error.code === "ENOENT") return { posts, errors };
      throw error;
    }
    for (const name of entries.filter((name) => name.endsWith(".md"))) {
      try {
        const post = await get(name.slice(0, -3));
        posts.push({
          ...post,
          data: {
            ...post.data,
            createdAt: new Date(post.data.createdAt),
            updatedAt: new Date(post.data.updatedAt),
            publishedAt: post.data.publishedAt
              ? new Date(post.data.publishedAt)
              : null,
          },
        });
      } catch (error) {
        errors.push({ file: name, message: error.message });
      }
    }
    return { posts, errors };
  }
  async function save(input, id) {
    if (!record(input)) fail("Invalid post payload.");
    const newPost = !id;
    id ||= randomUUID();
    const file = await filename(id, true);
    return serial(file, async () => {
      const existing = newPost ? null : await get(id);
      if (existing && input.revision !== existing.revision)
        throw new InputError(
          "This post changed on disk. Your edits are still here. Copy them before reloading the saved version.",
          409,
        );
      if (existing && input.type !== existing.data.type)
        fail("Post type cannot change after the first save.");
      const now = new Date().toISOString();
      const data = {
        ...(existing?.data ?? {}),
        type: input.type,
        status: input.status,
        title: string(input.title ?? "", "Title", 500),
        tags: normalizeTags(input.tags ?? []),
        createdAt: existing?.data.createdAt ?? now,
        updatedAt: existing?.data.updatedAt ?? now,
        publishedAt:
          input.publishedAt ||
          existing?.data.publishedAt ||
          (input.status === "published" ? now : null),
      };
      const merge = (old, next) => {
        if (!record(next)) fail("Media and link fields must be objects.");
        return { ...(record(old) ? old : {}), ...next };
      };
      if (input.type === "photo") {
        data.photos = mergePhotos(
          existing?.data.photos ?? [],
          input.photos === undefined ? [] : input.photos,
        );
      }
      if (input.type === "link")
        data.link = input.link
          ? merge(existing?.data.link, input.link)
          : undefined;
      if (["audio", "video"].includes(input.type))
        data.media = input.media
          ? merge(existing?.data.media, input.media)
          : undefined;
      const body =
        input.body === undefined && existing
          ? existing.body
          : string(input.body, "Markdown", 1000000);
      validate(data, body);
      if (["audio", "video"].includes(input.type) && data.media) {
        const media = data.media;
        // Video thumbnails and audio artwork. A generated image belongs to the
        // source it came from.
        if (
          generated(media.poster) &&
          existing &&
          media.src !== existing.data.media?.src &&
          media.poster === existing.data.media?.poster
        )
          delete media.poster;
        if (media.kind === "embed" && !media.poster && providerLookups) {
          const bytes = await fetchThumbnail(media.src, input.type).catch(
            () => null,
          );
          if (bytes)
            media.poster = await upload("thumbnail", bytes).then(
              (result) => result.src,
              () => undefined,
            );
          if (!media.poster) delete media.poster;
        }
      }
      if (input.type === "audio" && data.media) {
        const media = data.media;
        // The resolved player follows its page link and is redone when it changes.
        if (media.kind !== "embed" || !bandcampPage(media.src))
          delete media.embed;
        else if (!media.embed || media.src !== existing?.data.media?.src) {
          delete media.embed;
          const player = providerLookups
            ? await fetchPlayer(media.src).catch(() => null)
            : null;
          if (player) media.embed = player;
        }
      }
      if (data.publishedAt && Date.parse(data.publishedAt) > Date.now())
        fail(
          "Choose a publication date in the past or leave it blank to publish now.",
        );
      if (
        existing &&
        JSON.stringify(data) === JSON.stringify(existing.data) &&
        body === existing.body
      )
        return existing;
      data.updatedAt = now;
      const raw = `---\n${stringify(data, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" })}---\n${body}`;
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, raw, { flag: "wx" });
        await filename(id);
        if (existing && (await get(id)).revision !== existing.revision)
          throw new InputError(
            "The file changed during save. Reload before trying again.",
            409,
          );
        if (newPost) {
          try {
            await lstat(file);
            throw new InputError("A post with this ID already exists.", 409);
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      }
      if (existing) await removeUnused(media(existing.data), media(data));
      return parsePost(raw, id);
    });
  }
  async function remove(id, revision) {
    const file = await filename(id);
    return serial(file, async () => {
      const existing = await get(id);
      if (revision !== existing.revision)
        throw new InputError(
          "This post changed on disk. Reload before deleting it.",
          409,
        );
      const trash = `.microbloggr/trash/${id}-${randomUUID()}.md`;
      const destination = await checked(root, trash, true);
      await ignoreTrash();
      if ((await get(id)).revision !== revision)
        throw new InputError("This post changed before deletion.", 409);
      await rename(await filename(id), destination);
      return { trash };
    });
  }
  // Keep deleted posts out of the site's Git history without editing the
  // project's own .gitignore.
  async function ignoreTrash() {
    const file = await checked(root, ".microbloggr/.gitignore", true);
    await writeFile(file, "# Microbloggr's trash. Not part of the site.\n*\n", {
      flag: "wx",
    }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  // Trashed files are named <post id>-<uuid>.md.
  const trashName =
    /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
  async function trashFile(trashId) {
    const match = typeof trashId === "string" && trashName.exec(trashId);
    if (!match) fail("Invalid trash entry.");
    return {
      file: await checked(root, `.microbloggr/trash/${trashId}.md`),
      postId: match[1],
    };
  }
  async function listTrash() {
    let folder, names;
    try {
      folder = await checked(root, ".microbloggr/trash");
      names = await readdir(folder);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const entries = [];
    for (const name of names) {
      const trashId = name.slice(0, -3);
      const match = name.endsWith(".md") && trashName.exec(trashId);
      if (!match) continue;
      const file = path.join(folder, name);
      try {
        const post = parsePost(await readFile(file, "utf8"), match[1]);
        entries.push({
          ...post,
          trashId,
          deletedAt: (await stat(file)).mtime.toISOString(),
        });
      } catch {
        // Unreadable trash is left alone for manual recovery.
      }
    }
    return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  // Move a trashed post back into the collection under its original ID.
  async function restore(trashId) {
    const { file, postId } = await trashFile(trashId);
    const target = await filename(postId, true);
    return serial(target, async () => {
      try {
        await lstat(file);
      } catch (error) {
        if (error.code === "ENOENT")
          throw new InputError("This post is no longer in the trash.", 404);
        throw error;
      }
      try {
        await lstat(target);
        throw new InputError(
          "A post with this ID already exists. Rename the trashed file to restore it.",
          409,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await rename(file, target);
      } catch (error) {
        if (error.code === "ENOENT")
          throw new InputError("This post is no longer in the trash.", 404);
        throw error;
      }
      return { id: postId };
    });
  }
  // Delete a trashed post for good, with any media no other post uses.
  async function purge(trashId) {
    const { file, postId } = await trashFile(trashId);
    return serial(file, async () => {
      let post;
      try {
        post = parsePost(await readFile(file, "utf8"), postId);
      } catch (error) {
        if (error.code === "ENOENT")
          throw new InputError("This post is no longer in the trash.", 404);
        throw error;
      }
      await unlink(file);
      await removeUnused(media(post.data), []);
      return { deleted: trashId };
    });
  }
  async function emptyTrash() {
    const entries = await listTrash();
    for (const entry of entries) await purge(entry.trashId);
    return { deleted: entries.length };
  }
  // Media files a post points at: its photos, media source, and poster.
  const media = (data) =>
    [
      ...(data.photos ?? []).map((photo) => photo.src),
      data.media?.src,
      data.media?.poster,
    ].filter(
      (src) => typeof src === "string" && src.startsWith(`/${mediaDir}/`),
    );
  // After a save, delete files the post stopped using, but only when no other
  // post, draft, or trashed post still refers to them.
  async function removeUnused(before, after) {
    const dropped = [...new Set(before)].filter((src) => !after.includes(src));
    if (!dropped.length) return;
    const texts = [];
    for (const dir of [contentDir, ".microbloggr/trash"]) {
      let names = [];
      try {
        const folder = await checked(root, dir);
        names = (await readdir(folder)).filter((name) => name.endsWith(".md"));
        for (const name of names)
          texts.push(await readFile(path.join(folder, name), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const publicRelative = path.relative(
      path.resolve(root),
      path.resolve(publicDir),
    );
    for (const src of dropped) {
      if (texts.some((text) => text.includes(src))) continue;
      try {
        await unlink(await checked(root, `${publicRelative}${src}`));
      } catch (error) {
        if (!(error instanceof InputError) && error.code !== "ENOENT")
          console.error("[microbloggr] Could not delete", src, error);
      }
    }
  }
  // Pasted links are downloaded so the post keeps a local copy.
  async function importUrl(type, source) {
    if (!["photo", "audio", "video"].includes(type))
      fail("Choose photo, audio, or video.");
    url(source, "Link", true);
    let bytes;
    try {
      bytes = await fetchMedia(source, limits[type]);
    } catch (error) {
      fail(`Could not download ${source}. ${error.message}`);
    }
    return upload(type, bytes);
  }
  async function upload(type, bytes) {
    if (!["photo", "audio", "video", "thumbnail"].includes(type))
      fail("Choose photo, audio, or video.");
    if (!bytes.length || bytes.length > limits[type])
      throw new InputError(
        `File exceeds the ${Math.round(limits[type] / 1024 ** 2)} MiB ${type} limit or is empty.`,
        413,
      );
    const detected = await fileTypeFromBuffer(bytes).catch(() => undefined);
    const allowed = {
      photo: ["jpg", "png", "webp", "gif", "avif"],
      audio: ["mp3", "m4a", "wav", "ogg", "oga", "opus"],
      video: ["mp4", "webm"],
      thumbnail: ["jpg", "png", "webp"],
    };
    if (!detected || !allowed[type].includes(detected.ext))
      fail(
        `Unsupported ${type} file. Its contents must match an allowed media format.`,
      );
    const folder = type === "thumbnail" ? "thumbnails" : type;
    const rel = `${mediaDir}/${folder}/${randomUUID()}.${detected.ext}`;
    // Astro's configured public directory must itself stay inside the project.
    const publicRelative = path.relative(
      path.resolve(root),
      path.resolve(publicDir),
    );
    relative(publicRelative, "publicDir");
    const file = await checked(root, `${publicRelative}/${rel}`, true);
    await writeFile(file, bytes, { flag: "wx" });
    return { src: `/${rel}`, size: bytes.length, mime: detected.mime };
  }
  return {
    list,
    get,
    save,
    remove,
    listTrash,
    restore,
    purge,
    emptyTrash,
    upload,
    importUrl,
    limits,
    thumbnailPath,
  };
}
