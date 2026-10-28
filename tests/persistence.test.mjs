import { microblogSchema } from "./fixtures/site/src/microblog.schema.ts";
import { microblogSchema as templateSchema } from "../templates/microblog.schema.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createStore,
  parsePost,
  validate,
} from "../src/server/store.mjs";
import { markdown } from "../src/render.mjs";
import { richTextUnavailableReason } from "../src/client/markdown.mjs";
import {
  bandcampPage,
  downloadMedia,
} from "../src/server/providers.mjs";
const draft = (overrides = {}) => ({
  type: "text",
  title: "Test",
  status: "draft",
  tags: [" Notes ", "notes", "Art"],
  body: "A body\n",
  ...overrides,
});
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "microbloggr-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "public"));
  return {
    root,
    store: createStore({
      root,
      publicDir: path.join(root, "public"),
      // Tests never reach providers; lookup tests inject fakes.
      providerLookups: false,
      ...options,
    }),
    file: (id) => path.join(root, "src/content/microblog", `${id}.md`),
  };
}
test("create, publish, backdate, draft, republish and restart retain dates and content", async (t) => {
  const { root, store, file } = await fixture(t);
  const first = await store.save(draft());
  assert.deepEqual(first.data.tags, ["Notes", "Art"]);
  assert.equal(first.data.publishedAt, null);
  assert.equal(first.data.createdAt, first.data.updatedAt);
  const publish = await store.save(
    draft({
      status: "published",
      revision: first.revision,
      publishedAt: "2020-05-12T12:00:00.000Z",
    }),
    first.id,
  );
  assert.equal(publish.data.createdAt, first.data.createdAt);
  const unpublished = await store.save(
    draft({ revision: publish.revision }),
    first.id,
  );
  assert.equal(unpublished.data.publishedAt, publish.data.publishedAt);
  const republished = await store.save(
    draft({ status: "published", revision: unpublished.revision }),
    first.id,
  );
  assert.equal(republished.data.publishedAt, publish.data.publishedAt);
  assert.equal(
    (
      await createStore({ root, publicDir: path.join(root, "public") }).get(
        first.id,
      )
    ).revision,
    republished.revision,
  );
  assert.equal(
    parsePost(await readFile(file(first.id), "utf8"), first.id).body,
    "A body\n",
  );
  assert.deepEqual(
    (await readdir(path.dirname(file(first.id)))).filter((name) =>
      name.endsWith(".tmp"),
    ),
    [],
  );
});
test("metadata edits preserve exact Markdown, unknown frontmatter and no-op timestamps", async (t) => {
  const { store, file } = await fixture(t);
  const first = await store.save(draft());
  const raw = `---\ntype: text\nstatus: draft\ntitle: Old\ntags: []\ncreatedAt: '2020-01-01T00:00:00.000Z'\nupdatedAt: '2020-01-01T00:00:00.000Z'\ncustom:\n  nested: [1, true, text]\n---\n\n#  Exact\r\n\r\n[ref]: /url\r\n`;
  await writeFile(file(first.id), raw);
  const loaded = await store.get(first.id);
  const changed = await store.save(
    {
      type: "text",
      status: "draft",
      title: "New",
      tags: [],
      revision: loaded.revision,
    },
    first.id,
  );
  assert.equal(changed.body, raw.slice(raw.indexOf("---\n", 4) + 4));
  assert.deepEqual(changed.data.custom, { nested: [1, true, "text"] });
  const noOp = await store.save(
    {
      type: "text",
      status: "draft",
      title: "New",
      tags: [],
      revision: changed.revision,
    },
    first.id,
  );
  assert.equal(noOp.revision, changed.revision);
  assert.equal(noOp.data.updatedAt, changed.data.updatedAt);
});
test("stale saves and deletes cannot overwrite external edits; concurrent saves conflict", async (t) => {
  const { store, file } = await fixture(t);
  const first = await store.save(draft());
  await writeFile(
    file(first.id),
    (await readFile(file(first.id), "utf8")).replace("A body", "External edit"),
  );
  await assert.rejects(
    store.save(draft({ revision: first.revision }), first.id),
    (e) => e.status === 409,
  );
  await assert.rejects(
    store.remove(first.id, first.revision),
    (e) => e.status === 409,
  );
  const current = await store.get(first.id);
  const results = await Promise.allSettled(
    ["One", "Two"].map((title) =>
      store.save(draft({ title, revision: current.revision }), first.id),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
});
test("deletion moves Markdown into recoverable trash and never removes media", async (t) => {
  const { root, store, file } = await fixture(t);
  const first = await store.save(draft());
  const raw = await readFile(file(first.id), "utf8");
  await writeFile(path.join(root, "public", "keep.wav"), "media");
  const result = await store.remove(first.id, first.revision);
  assert.equal(await readFile(path.join(root, result.trash), "utf8"), raw);
  assert.equal(
    await readFile(path.join(root, "public", "keep.wav"), "utf8"),
    "media",
  );
  await assert.rejects(store.get(first.id), (e) => e.status === 404);
});
test("all post types save their fields; incomplete drafts are allowed", async (t) => {
  const { store } = await fixture(t);
  for (const [type, payload] of Object.entries({
    photo: { photos: [{ src: "/photo.png" }] },
    link: { link: { url: "https://example.com" } },
    audio: { media: { src: "/audio.mp3", kind: "file" } },
    video: {
      media: {
        src: "https://vimeo.com/1",
        kind: "embed",
        poster: "/poster.png",
      },
    },
  })) {
    const incomplete = await store.save(draft({ type }));
    await assert.rejects(
      store.save(
        draft({ type, status: "published", revision: incomplete.revision }),
        incomplete.id,
      ),
      /before publishing/,
    );
    const complete = await store.save(
      draft({
        type,
        ...payload,
        status: "published",
        revision: incomplete.revision,
      }),
      incomplete.id,
    );
    for (const [key, value] of Object.entries(payload)) {
      const actual = complete.data[key];
      assert.deepEqual(
        key === "photos" ? actual.map(({ id, ...photo }) => photo) : actual,
        value,
      );
    }
  }
});

test("photo IDs preserve metadata through reorder, removal and URL changes", async (t) => {
  const { store } = await fixture(t);
  const first = await store.save(
    draft({
      type: "photo",
      photos: [
        {
          id: "tumblr-a",
          src: "/a.jpg",
          imported: { sourceId: "123" },
        },
        { id: "twitter-b", src: "/b.jpg", caption: "B caption" },
      ],
    }),
  );
  const reordered = await store.save(
    draft({
      type: "photo",
      revision: first.revision,
      photos: [
        { id: "twitter-b", src: "/new-b.jpg" },
        { id: "tumblr-a", src: "/a.jpg" },
      ],
    }),
    first.id,
  );
  assert.deepEqual(reordered.data.photos, [
    { id: "twitter-b", src: "/new-b.jpg", caption: "B caption" },
    first.data.photos[0],
  ]);
  const removed = await store.save(
    draft({
      type: "photo",
      revision: reordered.revision,
      photos: [
        {
          id: "new-photo",
          src: "/a.jpg",
        },
        { id: "twitter-b", src: "/new-b.jpg" },
      ],
    }),
    first.id,
  );
  assert.equal(removed.data.photos[0].imported, undefined);
  assert.equal(removed.data.photos[0].caption, undefined);
  assert.equal(removed.data.photos[1].caption, "B caption");
  assert.deepEqual(
    (await store.get(first.id)).data.photos,
    removed.data.photos,
  );
});

test("legacy photos acquire stable IDs on save without changing files on read", async (t) => {
  const { store, file } = await fixture(t);
  const first = await store.save(
    draft({
      type: "photo",
      photos: [
        { src: "/a.jpg", imported: { sourceId: "123" } },
        { src: "/b.jpg", caption: "B caption" },
      ],
    }),
  );
  const raw = (await readFile(file(first.id), "utf8")).replace(
    /^\s+"id":.*\n/gm,
    "\n",
  );
  await writeFile(file(first.id), raw);
  const legacy = await store.get(first.id);
  assert.ok(legacy.data.photos.every((photo) => photo.id === undefined));
  assert.equal(await readFile(file(first.id), "utf8"), raw);
  const migrated = await store.save(
    draft({
      type: "photo",
      revision: legacy.revision,
      photos: [{ src: "/b.jpg" }, { src: "/a.jpg" }],
    }),
    first.id,
  );
  assert.equal(migrated.data.photos[0].caption, "B caption");
  assert.deepEqual(migrated.data.photos[1].imported, { sourceId: "123" });
  for (const photo of migrated.data.photos)
    assert.match(photo.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(migrated.data.photos[0].id, migrated.data.photos[1].id);
  const unchanged = await store.save(
    draft({
      type: "photo",
      revision: migrated.revision,
      photos: migrated.data.photos,
    }),
    first.id,
  );
  assert.equal(unchanged.revision, migrated.revision);
  const replacement = await store.save(
    draft({
      type: "photo",
      revision: unchanged.revision,
      // The current composer carries the first photo's metadata with a URL edit.
      photos: [{ ...unchanged.data.photos[0], src: "/replacement.jpg" }],
    }),
    first.id,
  );
  assert.equal(replacement.data.photos[0].id, migrated.data.photos[0].id);
  assert.equal(replacement.data.photos[0].caption, "B caption");
});

test("ambiguous ID-less edits fail without changing the saved photo metadata", async (t) => {
  const { store, file } = await fixture(t);
  const first = await store.save(
    draft({
      type: "photo",
      photos: [
        { id: "a", src: "/same.jpg", caption: "First" },
        { id: "b", src: "/same.jpg", caption: "Second" },
      ],
    }),
  );
  const raw = await readFile(file(first.id), "utf8");
  await assert.rejects(
    store.save(
      draft({
        type: "photo",
        revision: first.revision,
        photos: [{ src: "/same.jpg" }],
      }),
      first.id,
    ),
    /multiple matches/,
  );
  await assert.rejects(
    store.save(
      draft({
        type: "photo",
        revision: first.revision,
        photos: [first.data.photos[0], first.data.photos[0]],
      }),
      first.id,
    ),
    /unique/,
  );
  assert.equal(await readFile(file(first.id), "utf8"), raw);
});

test("both photo schemas match server validation and retain custom photo metadata", () => {
  const photo = {
    id: "tumblr-123_1",
    src: "/a.jpg",
    imported: { sourceId: "123" },
  };
  const data = {
    ...draft({ type: "photo", tags: [] }),
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    publishedAt: null,
  };
  for (const photos of [undefined, [], [photo], [{ src: "/legacy.jpg" }]]) {
    assert.doesNotThrow(() => validate({ ...data, photos }, ""));
    for (const schema of [microblogSchema, templateSchema])
      assert.deepEqual(schema.parse({ ...data, photos }).photos, photos);
  }
  for (const photos of [
    null,
    {},
    [null],
    [photo, photo],
    Array.from({ length: 101 }, () => ({ src: "/a.jpg" })),
    ...["", " ", "has spaces", "a/b", "_start", "a".repeat(129), 123, null].map(
      (id) => [{ ...photo, id }],
    ),
    [{ ...photo, src: "javascript:alert(1)" }],
  ]) {
    assert.throws(() => validate({ ...data, photos }, ""));
    for (const schema of [microblogSchema, templateSchema])
      assert.equal(schema.safeParse({ ...data, photos }).success, false);
  }
  for (const photos of [undefined, []]) {
    const published = {
      ...data,
      photos,
      status: "published",
      publishedAt: data.createdAt,
    };
    assert.throws(() => validate(published, ""));
    for (const schema of [microblogSchema, templateSchema])
      assert.equal(schema.safeParse(published).success, false);
  }
});
test("invalid fields, publication dates, type changes, malformed YAML and executable URLs fail safely", async (t) => {
  const { store, file } = await fixture(t);
  const first = await store.save(draft());
  for (const invalid of [
    draft({ status: "published", body: " " }),
    draft({ status: "published", publishedAt: "2999-01-01T00:00:00Z" }),
    draft({ publishedAt: "bad" }),
    draft({ tags: [42] }),
    draft({ type: "link", link: { url: "javascript:alert(1)" } }),
    draft({ type: "photo", photos: [{ src: "//evil.test/image" }] }),
  ])
    await assert.rejects(store.save(invalid));
  await assert.rejects(
    store.save(draft({ type: "photo", revision: first.revision }), first.id),
    /type cannot change/,
  );
  await writeFile(file("broken"), "---\ninvalid: [\n---\nbody");
  const result = await store.list();
  assert.equal(result.posts.length, 1);
  assert.equal(result.errors[0].file, "broken.md");
  assert.equal(
    await readFile(file("broken"), "utf8"),
    "---\ninvalid: [\n---\nbody",
  );
});
test("path traversal and symlinked content, trash and upload directories are rejected", async (t) => {
  const { root, store, file } = await fixture(t);
  await assert.rejects(store.get("../outside"));
  assert.throws(() =>
    createStore({
      root,
      publicDir: path.join(root, "public"),
      contentDir: "../outside",
    }),
  );
  const first = await store.save(draft());
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(root, ".microbloggr"));
  await assert.rejects(store.remove(first.id, first.revision), /Symlinks/);
  await symlink(file(first.id), file("linked"));
  await assert.rejects(store.get("linked"), /Symlinks/);
  await symlink(outside, path.join(root, "public", "assets"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=",
    "base64",
  );
  await assert.rejects(store.upload("photo", png), /Symlinks/);
  assert.deepEqual(await readdir(outside), []);
});
test("uploads check real signatures and limits and use unique public URLs", async (t) => {
  const { root, store } = await fixture(t, { uploadLimits: { photo: 200 } });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=",
    "base64",
  );
  const first = await store.upload("photo", png),
    second = await store.upload("photo", png);
  assert.notEqual(first.src, second.src);
  assert.match(first.src, /^\/assets\/microblog\/photo\/.+\.png$/);
  assert.deepEqual(await readFile(path.join(root, "public", first.src)), png);
  await assert.rejects(
    store.upload("photo", Buffer.from('<svg onload="alert(1)"/>')),
    /Unsupported/,
  );
  await assert.rejects(store.upload("audio", png), /Unsupported/);
  await assert.rejects(
    store.upload("photo", Buffer.alloc(201)),
    (e) => e.status === 413,
  );
});
test("Markdown rendering sanitizes executable HTML and resolves images against base", () => {
  const output = markdown(
    "<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![photo](/image.png)",
    "/garden/",
  );
  assert.ok(!output.includes("<script"));
  assert.ok(!output.includes("javascript:"));
  assert.ok(output.includes("/garden/image.png"));
});
test("unsupported Markdown stays in source mode", () => {
  for (const body of [
    "![image](/x.png)",
    "<div>HTML</div>",
    "|a|b|\n|-|-|\n|c|d|",
    "- [ ] task",
    "[ref][id]\n\n[id]: /a",
    '```js title="hello"\ncode\n```',
  ])
    assert.ok(richTextUnavailableReason(body), body);
  assert.equal(
    richTextUnavailableReason(
      "# Heading\n\n**bold** and [link](https://example.com)\n\n- item",
    ),
    null,
  );
});

test("link posts drop the retired description and preview image fields", async (t) => {
  const { store } = await fixture(t);
  const post = await store.save(
    draft({
      type: "link",
      link: { url: "https://example.com", description: "Old", image: "/a.png" },
    }),
  );
  assert.deepEqual(post.data.link, { url: "https://example.com" });
});

test("empty optional media fields produce records accepted by the editable Astro schema", async (t) => {
  const { store } = await fixture(t);
  for (const extra of [
    {
      type: "link",
      link: { url: "https://example.com", description: "", image: "" },
    },
    { type: "audio", media: { kind: "file", src: "/audio.wav", poster: "" } },
    {
      type: "video",
      media: { kind: "embed", src: "https://vimeo.com/1", poster: "" },
    },
  ]) {
    const post = await store.save(draft({ ...extra, status: "published" }));
    assert.equal(microblogSchema.safeParse(post.data).success, true);
  }
});
test("audio uploads retain their actual format", async (t) => {
  const { store } = await fixture(t);
  const wav = await readFile(
    new URL(
      "./fixtures/site/public/assets/microblog/audio/afternoon.wav",
      import.meta.url,
    ),
  );
  const uploaded = await store.upload("audio", wav);
  assert.match(uploaded.src, /\.wav$/);
  await assert.rejects(store.upload("video", wav), /Unsupported/);
});

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=",
  "base64",
);
const media = (type, src, extra = {}) => ({
  type,
  status: "draft",
  tags: [],
  body: "",
  media: { kind: "embed", src, ...extra },
});

test("video saves store provider thumbnails and replace only generated ones when the source changes", async (t) => {
  const seen = [];
  const { root, store } = await fixture(t, {
    providerLookups: true,
    fetchThumbnail: async (src) => (seen.push(src), pixel),
  });
  const first = await store.save(
    media("video", "https://youtu.be/aqz-KE-bpKQ"),
  );
  const poster = first.data.media.poster;
  assert.match(poster, /^\/assets\/microblog\/thumbnails\/.+\.png$/);
  assert.deepEqual(await readFile(path.join(root, "public", poster)), pixel);
  const same = await store.save(
    {
      ...media("video", "https://youtu.be/aqz-KE-bpKQ", { poster }),
      revision: first.revision,
    },
    first.id,
  );
  assert.equal(same.data.media.poster, poster);
  assert.equal(seen.length, 1, "An unchanged source keeps its thumbnail");
  const moved = await store.save(
    {
      ...media("video", "https://vimeo.com/76979871", { poster }),
      revision: same.revision,
    },
    first.id,
  );
  assert.notEqual(moved.data.media.poster, poster);
  assert.deepEqual(seen, [
    "https://youtu.be/aqz-KE-bpKQ",
    "https://vimeo.com/76979871",
  ]);
  const chosen = await store.save(
    {
      ...media("video", "https://youtu.be/aqz-KE-bpKQ", { poster: "/art.jpg" }),
      revision: moved.revision,
    },
    first.id,
  );
  assert.equal(chosen.data.media.poster, "/art.jpg", "Author posters stay");
  assert.equal(seen.length, 2);
});

test("failed or disabled provider lookups still save the post", async (t) => {
  const offline = await fixture(t, {
    providerLookups: true,
    fetchThumbnail: async () => {
      throw new Error("offline");
    },
    fetchPlayer: async () => null,
  });
  const video = await offline.store.save(
    media("video", "https://youtu.be/aqz-KE-bpKQ"),
  );
  assert.equal(video.data.media.poster, undefined);
  const audio = await offline.store.save(
    media("audio", "https://tycho.bandcamp.com/album/dive"),
  );
  assert.equal(audio.data.media.embed, undefined);
  let called = false;
  const disabled = await fixture(t, {
    fetchThumbnail: async () => ((called = true), pixel),
  });
  await disabled.store.save(media("video", "https://youtu.be/aqz-KE-bpKQ"));
  assert.equal(called, false);
});

test("Bandcamp page links resolve to a player kept beside the original link", async (t) => {
  const player = "https://bandcamp.com/EmbeddedPlayer/album=3619628392/";
  let calls = 0;
  const { store, file } = await fixture(t, {
    providerLookups: true,
    fetchPlayer: async () => (calls++, player),
  });
  const post = await store.save(
    media("audio", "https://tycho.bandcamp.com/album/dive"),
  );
  assert.equal(post.data.media.src, "https://tycho.bandcamp.com/album/dive");
  assert.equal(post.data.media.embed, player);
  assert.match(
    await readFile(file(post.id), "utf8"),
    /EmbeddedPlayer\/album=3619628392/,
  );
  const again = await store.save(
    {
      ...media("audio", "https://tycho.bandcamp.com/album/dive"),
      revision: post.revision,
    },
    post.id,
  );
  assert.equal(again.data.media.embed, player);
  assert.equal(calls, 1);
  const other = await store.save(
    {
      ...media("audio", "https://soundcloud.com/tycho/awake"),
      revision: again.revision,
    },
    post.id,
  );
  assert.equal(other.data.media.embed, undefined);
  assert.throws(
    () =>
      validate(
        {
          type: "audio",
          status: "draft",
          tags: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          media: {
            kind: "embed",
            src: "https://tycho.bandcamp.com/album/dive",
            embed: "https://evil.test/",
          },
        },
        "",
      ),
    /Bandcamp EmbeddedPlayer/,
  );
  assert.equal(bandcampPage("https://tycho.bandcamp.com/album/dive"), true);
  assert.equal(bandcampPage("https://tycho.bandcamp.com/track/awake"), true);
  for (const source of [
    "http://tycho.bandcamp.com/album/dive",
    "https://bandcamp.com.evil.test/album/dive",
    "https://tycho.bandcamp.com/music",
    "https://bandcamp.com/EmbeddedPlayer/album=1/",
  ])
    assert.equal(bandcampPage(source), false, source);
});

test("audio embeds save provider artwork as a generated poster", async (t) => {
  const seen = [];
  const { store } = await fixture(t, {
    providerLookups: true,
    fetchThumbnail: async (src, type) => (seen.push([src, type]), pixel),
    fetchPlayer: async () => null,
  });
  const post = await store.save(
    media("audio", "https://soundcloud.com/tycho/awake"),
  );
  assert.match(post.data.media.poster, /^\/assets\/microblog\/thumbnails\//);
  assert.deepEqual(seen, [["https://soundcloud.com/tycho/awake", "audio"]]);
});

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=",
  "base64",
);
const exists = (file) =>
  readFile(file).then(
    () => true,
    () => false,
  );

test("photos drop alternative text and the decorative flag on save", async (t) => {
  const { store } = await fixture(t);
  const post = await store.save(
    draft({
      type: "photo",
      photos: [{ id: "a", src: "/a.jpg", alt: "Old", decorative: true }],
    }),
  );
  assert.deepEqual(post.data.photos, [{ id: "a", src: "/a.jpg" }]);
});

test("saving deletes media files a post stopped using, unless another post uses them", async (t) => {
  const { root, store } = await fixture(t);
  const [kept, dropped, shared] = await Promise.all(
    [1, 2, 3].map(() => store.upload("photo", tinyPng)),
  );
  const onDisk = (src) => exists(path.join(root, "public", src));
  const other = await store.save(
    draft({ type: "photo", photos: [{ src: shared.src }] }),
  );
  const post = await store.save(
    draft({
      type: "photo",
      photos: [{ src: kept.src }, { src: dropped.src }, { src: shared.src }],
    }),
  );
  await store.save(
    draft({
      type: "photo",
      revision: post.revision,
      photos: [{ src: kept.src }, { src: "https://example.com/remote.jpg" }],
    }),
    post.id,
  );
  assert.equal(await onDisk(kept.src), true);
  assert.equal(await onDisk(dropped.src), false);
  assert.equal(await onDisk(shared.src), true, "another post still uses it");
  // A trashed post still counts as a user, so restoring it keeps its media.
  await store.remove(other.id, other.revision);
  const next = await store.get(post.id);
  await store.save(
    draft({ type: "photo", revision: next.revision, photos: [] }),
    post.id,
  );
  assert.equal(await onDisk(kept.src), false);
  assert.equal(await onDisk(shared.src), true);
});

test("pasted media links are downloaded into the media folder", async (t) => {
  const requested = [];
  const { root, store } = await fixture(t, {
    fetchMedia: async (url, limit) => {
      requested.push([url, limit]);
      if (url.includes("broken")) throw new Error("The link returned 404.");
      return tinyPng;
    },
  });
  const saved = await store.importUrl("photo", "https://example.com/a.png");
  assert.match(saved.src, /^\/assets\/microblog\/photo\/.+\.png$/);
  assert.deepEqual(
    await readFile(path.join(root, "public", saved.src)),
    tinyPng,
  );
  assert.deepEqual(requested, [
    ["https://example.com/a.png", store.limits.photo],
  ]);
  await assert.rejects(
    store.importUrl("photo", "https://example.com/broken.png"),
    /Could not download .*404/,
  );
  await assert.rejects(store.importUrl("photo", "/local.png"), /HTTP\(S\)/);
  await assert.rejects(
    store.importUrl("video", "https://example.com/a.png"),
    /Unsupported video/,
  );
});

test("media downloads refuse local and private addresses", async () => {
  for (const url of [
    "http://127.0.0.1/a.png",
    "http://localhost/a.png",
    "http://10.0.0.5/a.png",
    "http://192.168.1.2/a.png",
    "http://169.254.169.254/latest",
    "http://[::1]/a.png",
    "file:///etc/passwd",
  ])
    await assert.rejects(
      downloadMedia(url, 1024),
      /local or private|http or https/,
    );
});

test("the trash lists, restores, and permanently deletes posts and their unused media", async (t) => {
  const { root, store, file } = await fixture(t);
  const [own, shared] = await Promise.all(
    [1, 2].map(() => store.upload("photo", tinyPng)),
  );
  const onDisk = (src) => exists(path.join(root, "public", src));
  const keeper = await store.save(
    draft({ type: "photo", photos: [{ src: shared.src }] }),
  );
  const post = await store.save(
    draft({ type: "photo", photos: [{ src: own.src }, { src: shared.src }] }),
  );
  await store.remove(post.id, post.revision);
  // The trash keeps itself out of Git.
  assert.match(
    await readFile(path.join(root, ".microbloggr/.gitignore"), "utf8"),
    /^\*$/m,
  );
  let [entry] = await store.listTrash();
  assert.equal(entry.id, post.id);
  assert.match(entry.trashId, new RegExp(`^${post.id}-`));
  assert.ok(Date.parse(entry.deletedAt));

  // Restoring puts the file back under its original ID.
  assert.deepEqual(await store.restore(entry.trashId), { id: post.id });
  assert.equal((await store.get(post.id)).data.photos.length, 2);
  assert.deepEqual(await store.listTrash(), []);
  await assert.rejects(store.restore(entry.trashId), /no longer in the trash/);

  // A post with the same ID blocks a restore instead of being overwritten.
  const again = await store.get(post.id);
  await store.remove(post.id, again.revision);
  [entry] = await store.listTrash();
  await writeFile(file(post.id), "---\ntype: text\n---\n");
  await assert.rejects(store.restore(entry.trashId), /already exists/);
  await rm(file(post.id));

  // Deleting forever removes the post and media no other post uses.
  await store.purge(entry.trashId);
  assert.deepEqual(await store.listTrash(), []);
  assert.equal(await onDisk(own.src), false);
  assert.equal(await onDisk(shared.src), true);

  await store.remove(keeper.id, keeper.revision);
  const extra = await store.save(draft());
  await store.remove(extra.id, extra.revision);
  assert.deepEqual(await store.emptyTrash(), { deleted: 2 });
  assert.equal(await onDisk(shared.src), false);
  await assert.rejects(store.purge("../../escape"), /Invalid trash entry/);
  await assert.rejects(store.restore("not-a-trash-id"), /Invalid trash entry/);
});
