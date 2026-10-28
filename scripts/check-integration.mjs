import { checkComposer } from "./check-composer.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  readFile,
  writeFile,
  readdir,
  mkdtemp,
  cp,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const playground = await mkdtemp(path.join(tmpdir(), "microbloggr-http-"));
await cp(path.join(root, "tests/fixtures/site"), playground, {
  recursive: true,
  filter: (source) => {
    if (
      ["node_modules", "dist", ".astro", ".microbloggr"].includes(
        path.basename(source),
      )
    )
      return false;
    // Assertions use the seed fixtures. Do not copy personal posts into this test.
    const content =
      path.join(root, "tests/fixtures/site/src/content/microblog") + path.sep;
    return (
      !source.startsWith(content) ||
      !source.endsWith(".md") ||
      /^08c0ffee-2026-4000-8000-\d{12}\.md$/.test(path.basename(source))
    );
  },
});
// The temporary consumer must resolve this checkout's integration.
await writeFile(
  path.join(playground, "astro.config.mjs"),
  (await readFile(path.join(playground, "astro.config.mjs"), "utf8")).replace(
    '"../../../src/index.mjs"',
    JSON.stringify(new URL("../src/index.mjs", import.meta.url).href),
  ),
);
await symlink(
  path.join(root, "node_modules"),
  path.join(playground, "node_modules"),
);
const cli = path.join(root, "node_modules/astro/bin/astro.mjs");
const firstId = "08c0ffee-2026-4000-8000-000000000001";
const draftId = "08c0ffee-2026-4000-8000-000000000005";
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function start(command, env = {}) {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      cli,
      command,
      "--root",
      playground,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: root,
      // Keep Astro's servers in the managed child instead of auto-detaching in agent sessions.
      env: {
        ...process.env,
        ASTRO_TELEMETRY_DISABLED: "1",
        ASTRO_DEV_BACKGROUND: "1",
        ASTRO_PREVIEW_BACKGROUND: "1",
        PLAYGROUND_PROVIDER_LOOKUPS: "off",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        const response = await fetch(`${origin}${env.PLAYGROUND_BASE || "/"}`, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) return { child, origin, logs: () => logs };
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Server did not start:\n${logs}`);
  } catch (error) {
    await stop(child);
    throw error;
  }
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}
async function html(origin, route, status = 200, options = {}) {
  const response = await fetch(`${origin}${route}`, options);
  const body = await response.text();
  assert.equal(response.status, status, `${route}: ${body.slice(0, 1200)}`);
  return body;
}
async function inspectDev(env = {}) {
  const server = await start("dev", env);
  const base = (env.PLAYGROUND_BASE || "/").replace(/\/$/, "");
  const editor = `${base}${env.PLAYGROUND_EDITOR_PATH || "/editor"}`;
  try {
    const feed = await html(server.origin, editor);
    assert.match(feed, /microbloggr-editor/);
    assert.equal((feed.match(/data-post-id=/g) || []).length, 10);
    assert.match(feed, /Something I am still working out/);
    assert.match(
      await html(server.origin, `${editor}?page=2`),
      /Some days, one sentence is enough/,
    );
    const archive = await html(server.origin, `${editor}/archive`);
    for (const month of [
      "October",
      "September",
      "August",
      "July",
      "June",
      "May",
    ])
      assert.ok(archive.includes(`${month} 2026`));
    const bandcamp = await html(
      server.origin,
      `${editor}/archive?q=bandcamp&type=audio&status=published`,
    );
    assert.match(bandcamp, /An album for getting lost in/);
    assert.equal((bandcamp.match(/class="archive-card /g) || []).length, 1);
    assert.match(
      await html(server.origin, `${editor}/posts/${firstId}`),
      /A slower corner of the internet/,
    );
    assert.match(
      await html(server.origin, `${editor}/posts/${firstId}/edit`),
      /data-composer/,
    );
    await html(server.origin, `${editor}/posts/missing`, 404);
    await html(server.origin, editor, 405, { method: "POST" });
    await html(server.origin, editor, 403, {
      headers: { Origin: "https://example.com" },
    });
    await html(server.origin, editor, 403, {
      headers: { "X-Forwarded-For": "192.168.1.1" },
    });
    const site = await html(server.origin, `${base}/`);
    assert.ok(!site.includes("Something I am still working out"));
    await html(server.origin, `${base}/posts/${draftId}/`, 404);
    assert.match(
      await html(server.origin, `${base}/assets/microblog/photo/hills.svg`),
      /<svg/,
    );
    const composer = await html(server.origin, `${editor}?type=text`);
    const clientUrl = /<script[^>]*src="([^"]*client\/entry.ts)"/.exec(
      composer,
    )?.[1];
    assert.ok(clientUrl, "Missing client entry");
    const clientModule = await html(server.origin, clientUrl);
    const composerUrl = /import\("([^"]*composer.ts)"\)/.exec(
      clientModule,
    )?.[1];
    assert.ok(composerUrl, "Missing composer module import");
    assert.match(await html(server.origin, composerUrl), /mountComposer/);
    await checkComposer(server.origin, editor, base, composer);
    const json = async (route, method, data, token, expected = 200) => {
      const response = await fetch(`${server.origin}${editor}/api${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Microbloggr-Token": token } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result;
    };
    const { token } = await json("/session", "GET");
    const beforeChange = await json("/changes", "GET");
    assert.ok(beforeChange.posts[firstId]);
    const changedFile = path.join(
      playground,
      "src/content/microblog",
      `${firstId}.md`,
    );
    const original = await readFile(changedFile, "utf8");
    try {
      await writeFile(changedFile, `${original}\nExternal file edit.\n`);
      const changed = await json("/changes", "GET");
      assert.notEqual(changed.posts[firstId], beforeChange.posts[firstId]);
      assert.ok(!JSON.stringify(changed).includes("External file edit."));
    } finally {
      await writeFile(changedFile, original);
    }
    const returnTo = `${editor}/archive?type=text&status=published&page=2`;
    const editFromArchive = await html(
      server.origin,
      `${editor}/posts/${firstId}/edit?returnTo=${encodeURIComponent(returnTo)}`,
    );
    assert.ok(
      editFromArchive.includes(
        `data-return-to="${returnTo.replaceAll("&", "&amp;")}"`,
      ),
    );
    assert.ok(
      !(
        await html(
          server.origin,
          `${editor}/posts/${firstId}/edit?returnTo=https://evil.test`,
        )
      ).includes('data-return-to="https://evil.test"'),
    );
    await json("/posts", "POST", {}, undefined, 403);
    await json("/posts", "POST", {}, "wrong-token", 403);
    // The live preview endpoint was removed with the preview panel.
    await json("/preview", "POST", { body: "" }, token, 404);
    for (const [type, src, player] of [
      [
        "video",
        "https://youtu.be/aqz-KE-bpKQ?autoplay=1",
        "www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
      ],
      [
        "video",
        "https://vimeo.com/76979871",
        "player.vimeo.com/video/76979871",
      ],
      [
        "audio",
        "https://soundcloud.com/tycho/awake",
        "w.soundcloud.com/player/",
      ],
      [
        "audio",
        "https://bandcamp.com/EmbeddedPlayer/album=3619628392/",
        "bandcamp.com/EmbeddedPlayer/album=3619628392/",
      ],
    ]) {
      const input = {
        type,
        status: "draft",
        tags: [],
        body: "Provider test",
        media: { kind: "embed", src },
      };
      const post = await json("/posts", "POST", input, token, 201);
      assert.equal(
        post.data.media.src,
        src,
        "Persist the provider URL, not generated markup",
      );
      const raw = await readFile(
        path.join(playground, "src/content/microblog", `${post.id}.md`),
        "utf8",
      );
      assert.ok(raw.includes(src));
      assert.ok(!raw.includes("<iframe"));
      for (const route of [editor, `${editor}/posts/${post.id}`]) {
        const rendered = await html(server.origin, route);
        assert.ok(rendered.includes(`src="https://${player}`));
        // The feed also lists other posts; only the post's own page is clean.
        if (route !== editor)
          assert.doesNotMatch(rendered, /class="provider-fallback"/);
        assert.match(rendered, /autoplay &#39;none&#39;|autoplay 'none'/);
      }
      await json(
        `/posts/${post.id}`,
        "DELETE",
        { revision: post.revision },
        token,
      );
    }
    await json(
      "/posts",
      "POST",
      {
        type: "audio",
        status: "draft",
        body: "",
        tags: [],
        media: {
          kind: "embed",
          src: '<iframe src="https://bandcamp.com/EmbeddedPlayer/album=123/"></iframe>',
        },
      },
      token,
      400,
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await fetch(
      `${server.origin}${editor}/api/uploads?type=photo`,
      { method: "POST", headers: { "X-Microbloggr-Token": token }, body: png },
    );
    assert.equal(upload.status, 201);
    const uploaded = await upload.json();
    let mediaResponse;
    for (let attempt = 0; attempt < 50; attempt++) {
      mediaResponse = await fetch(`${server.origin}${base}${uploaded.src}`);
      if (mediaResponse.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      mediaResponse.status,
      200,
      "Vite should discover new public uploads",
    );
    assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), png);
    for (const [type, extra] of Object.entries({
      text: {},
      photo: { photos: [{ src: uploaded.src, alt: "Test photo" }] },
      link: {
        link: { url: "https://example.com" },
      },
      audio: { media: { kind: "file", src: "/audio.mp3" } },
      video: { media: { kind: "embed", src: "https://vimeo.com/1" } },
    })) {
      const input = {
        type,
        title: `HTTP ${type}`,
        body: "**Saved** body",
        tags: ["test"],
        status: "draft",
        ...extra,
      };
      const created = await json("/posts", "POST", input, token, 201);
      assert.match(
        await html(server.origin, `${editor}/posts/${created.id}`),
        /Saved/,
      );
      assert.match(
        await html(server.origin, `${editor}/posts/${created.id}/edit`),
        /data-composer/,
      );
      const published = await json(
        `/posts/${created.id}`,
        "PUT",
        {
          ...input,
          status: "published",
          revision: created.revision,
          publishedAt: "2020-01-01T12:00:00.000Z",
        },
        token,
      );
      assert.equal(published.data.status, "published");
      await json(
        `/posts/${created.id}`,
        "PUT",
        { ...input, revision: created.revision },
        token,
        409,
      );
      await json(
        `/posts/${created.id}`,
        "DELETE",
        { revision: created.revision },
        token,
        409,
      );
      const result = await json(
        `/posts/${created.id}`,
        "DELETE",
        { revision: published.revision },
        token,
      );
      assert.ok(
        (await readFile(path.join(playground, result.trash), "utf8")).includes(
          "Saved",
        ),
      );
      await json(`/posts/${created.id}`, "GET", undefined, undefined, 404);
      // The trash page and API can bring the post back.
      const entry = (await json("/trash", "GET")).find(
        (item) => item.id === created.id,
      );
      assert.ok(entry);
      assert.ok(
        (await html(server.origin, `${editor}/trash`)).includes(entry.trashId),
      );
      await json(`/trash/${entry.trashId}/restore`, "POST", {}, undefined, 403);
      await json(`/trash/${entry.trashId}/restore`, "POST", {}, token);
      await json(`/posts/${created.id}`, "GET");
      const restored = await json(`/posts/${created.id}`, "GET");
      await json(
        `/posts/${created.id}`,
        "DELETE",
        { revision: restored.revision },
        token,
      );
    }
    assert.equal(
      (await fetch(`${server.origin}${base}${uploaded.src}`)).status,
      200,
    );
    // Emptying the trash deletes every trashed post for good, with its media.
    await json("/trash", "DELETE", {}, token);
    await assert.rejects(
      readFile(path.join(playground, "public", uploaded.src)),
      /ENOENT/,
    );
    assert.deepEqual(await json("/trash", "GET"), []);
    assert.match(
      await readFile(path.join(playground, ".microbloggr/.gitignore"), "utf8"),
      /^\*$/m,
    );
    console.log(
      `PASS saves, publication, uploads, stale edits, tokens, trash, restore, and emptying: ${editor}`,
    );
    console.log(
      `PASS dev routes, seeds, filters, drafts, and request restrictions: ${editor}`,
    );
  } catch (error) {
    console.error(server.logs());
    throw error;
  } finally {
    await stop(server.child);
  }
}
async function build() {
  const child = spawn(process.execPath, [cli, "build", "--root", playground], {
    cwd: root,
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: "1",
      PLAYGROUND_BASE: "/",
      PLAYGROUND_EDITOR_PATH: "/editor",
    },
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "Astro build failed");
}
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : path.join(directory, entry.name),
      ),
    )
  ).flat();
}
async function inspectBuild() {
  const output = path.join(playground, "dist");
  const built = await files(output);
  assert.equal(
    built.filter((file) => file.endsWith(".html")).length,
    14,
    "Expected public index and 13 published detail pages",
  );
  for (const file of built) {
    assert.ok(!file.includes("/editor/"), `Editor route in build: ${file}`);
    if (!/\.(html|js|css|json|map)$/.test(file)) continue;
    const contents = await readFile(file, "utf8");
    for (const marker of [
      "microbloggr-editor",
      "virtual:microbloggr",
      "astro-dev-toolbar",
      "Make a little something",
      "Writing tools are next",
      "data-composer",
      "X-Microbloggr-Token",
      "ProseMirror",
      "cm-editor",
      "provider-player",
      "data-change-notice",
      "microbloggr:scroll:",
      "youtube-nocookie.com/embed/",
      "w.soundcloud.com/player/",
      "Something I am still working out",
      "A photo I have not picked yet",
      "A bookmark for later",
    ])
      assert.ok(!contents.includes(marker), `Unexpected ${marker} in ${file}`);
  }
  assert.ok(
    !built.some((file) => /\.(js|woff2?)$/.test(file)),
    "This public theme needs no scripts or editor fonts",
  );
  console.log(
    "PASS production output excludes editor code, styles, routes, and draft content",
  );
}

try {
  await build();
  await inspectBuild();
  await inspectDev();
  await inspectDev({
    PLAYGROUND_BASE: "/garden/",
    PLAYGROUND_EDITOR_PATH: "/tools/write",
  });
  await build();
  await inspectBuild();
  const preview = await start("preview");
  try {
    await html(preview.origin, "/editor", 404);
    await html(preview.origin, "/editor/archive", 404);
    await html(preview.origin, `/editor/posts/${firstId}`, 404);
    await html(preview.origin, `/posts/${draftId}/`, 404);
    console.log("PASS production preview has no editor or draft routes");
  } finally {
    await stop(preview.child);
  }
} finally {
  await rm(playground, { recursive: true, force: true });
}
