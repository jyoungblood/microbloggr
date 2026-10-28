import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { editorReturn } from "../src/navigation.mjs";
import { collectionState } from "../src/server/changes.mjs";

const compiled = await build({
  entryPoints: [
    new URL("../src/client/page.ts", import.meta.url)
      .pathname,
  ],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "PageTest",
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

test("editor entry defers wildcard content reloads and requests a notification check", async () => {
  const entry = await build({
    entryPoints: [
      new URL("../src/client/entry.ts", import.meta.url)
        .pathname,
    ],
    bundle: true,
    write: false,
    format: "iife",
    external: ["./composer"],
    define: { "import.meta.hot": "globalThis.testHot" },
  });
  const dom = new JSDOM('<body data-editor-url="/garden/write"></body>', {
    url: "http://localhost/garden/write/archive",
    runScripts: "outside-only",
  });
  try {
    let reload,
      checks = 0;
    dom.window.testHot = {
      on: (event, handler) => {
        assert.equal(event, "vite:beforeFullReload");
        reload = handler;
      },
    };
    dom.window.document.addEventListener("microbloggr:check", () => checks++);
    dom.window.eval(entry.outputFiles[0].text);
    const content = { type: "full-reload", path: "*" };
    reload(content);
    assert.equal(checks, 1);
    assert.ok(content.path.endsWith(".html"));
    assert.notEqual(content.path, "/index.html");
    assert.notEqual(content.path, dom.window.location.pathname);
    const source = { type: "full-reload", path: "/src/pages/editor.astro" };
    reload(source);
    assert.equal(
      source.path,
      "/src/pages/editor.astro",
      "Keep targeted source reloads unchanged",
    );
  } finally {
    dom.window.close();
  }
});
function page(url, snapshot = { posts: { one: "old" }, errors: [] }) {
  const dom = new JSDOM(
    `<body><div data-change-notice hidden><span data-change-message></span><a>Reload</a></div><a class="archive-card" href="/garden/write/posts/one/edit">One</a></body>`,
    {
      url: `http://localhost${url}`,
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    },
  );
  dom.window.document.body.dataset.collectionState = JSON.stringify(snapshot);
  dom.window.eval(compiled.outputFiles[0].text);
  return dom;
}

test("return URLs allow the feed, archive, and post pages and reject anything else", () => {
  const editor = "/garden/tools/write";
  for (const value of [
    `${editor}/archive?type=photo&q=a%26b&page=2`,
    editor,
    `${editor}?page=2`,
    `${editor}/posts/one`,
  ])
    assert.equal(editorReturn(value, editor), value);
  for (const value of [
    "https://evil.test",
    "//evil.test/garden/tools/write/archive",
    "/editor/archive",
    `${editor}/posts/one/edit`,
    `${editor}/settings`,
    `${editor}/archive/../posts`,
    `${editor}/archive\\evil`,
    null,
  ])
    assert.equal(editorReturn(value, editor), undefined);
});

test("archive restores scroll and card focus separately for each query and handles blocked storage", async () => {
  const url = "/garden/write/archive?type=photo&page=2";
  const dom = page(url);
  const { window } = dom;
  try {
    let restored;
    window.scrollTo = (options) => {
      restored = options.top;
    };
    window.sessionStorage.setItem(
      `microbloggr:scroll:${url}`,
      JSON.stringify({ y: 940, href: "/garden/write/posts/one/edit" }),
    );
    window.PageTest.mountArchive("/garden/write");
    await flush();
    assert.equal(restored, 940);
    assert.equal(window.document.activeElement.className, "archive-card");
    Object.defineProperty(window, "scrollY", {
      value: 1120,
      configurable: true,
    });
    window.dispatchEvent(new window.Event("pagehide"));
    assert.equal(
      JSON.parse(window.sessionStorage.getItem(`microbloggr:scroll:${url}`)).y,
      1120,
    );
    window.history.replaceState({}, "", "/garden/write/archive?type=audio");
    restored = undefined;
    window.PageTest.mountArchive("/garden/write");
    await flush();
    assert.equal(
      restored,
      undefined,
      "A different filter starts at its own position",
    );
    window.history.replaceState({}, "", "/garden/write/archive?q=unavailable");
    window.Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    window.Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    assert.doesNotThrow(() => window.PageTest.mountArchive("/garden/write"));
    window.dispatchEvent(new window.Event("pagehide"));
  } finally {
    window.close();
  }
});

test("collection state contains revisions and stable file errors, never post bodies", () => {
  assert.deepEqual(
    collectionState({
      posts: [{ id: "one", revision: "abc", body: "private" }],
      errors: [
        { file: "z.md", message: "bad" },
        { file: "a.md", message: "missing" },
      ],
    }),
    {
      posts: { one: "abc" },
      errors: [
        { file: "a.md", message: "missing" },
        { file: "z.md", message: "bad" },
      ],
    },
  );
});

test("notifications distinguish changed, unreadable and removed posts without touching forms", async () => {
  const dom = page("/garden/write/posts/one/edit");
  const { window } = dom;
  try {
    const form = window.document.createElement("form");
    form.dataset.composer = "";
    form.dataset.initial = JSON.stringify({ id: "one", revision: "old" });
    form.innerHTML =
      '<fieldset><input value="unsaved title"><textarea>unsaved body</textarea></fieldset>';
    window.document.body.append(form);
    let snapshot = { posts: { one: "old" }, errors: [] };
    window.fetch = async () => ({ ok: true, json: async () => snapshot });
    window.PageTest.mountChanges("/garden/write");
    await flush();
    const notice = window.document.querySelector("[data-change-notice]");
    const message = window.document.querySelector("[data-change-message]");
    assert.equal(notice.hidden, true);
    snapshot = { posts: { one: "external" }, errors: [] };
    window.dispatchEvent(new window.Event("focus"));
    await flush();
    assert.match(message.textContent, /This post changed on disk/);
    assert.equal(form.querySelector("input").value, "unsaved title");
    assert.equal(form.querySelector("textarea").value, "unsaved body");
    assert.equal(JSON.parse(form.dataset.initial).revision, "old");
    snapshot = {
      posts: {},
      errors: [{ file: "one.md", message: "Invalid YAML" }],
    };
    window.dispatchEvent(new window.Event("focus"));
    await flush();
    assert.match(message.textContent, /could not be read/);
    snapshot = { posts: {}, errors: [] };
    window.dispatchEvent(new window.Event("focus"));
    await flush();
    assert.match(message.textContent, /removed from disk/);
    snapshot = { posts: { one: "old" }, errors: [] };
    window.dispatchEvent(new window.Event("focus"));
    await flush();
    assert.equal(notice.hidden, true, "An exact revert clears the notice");
  } finally {
    window.close();
  }
});

test("polling skips hidden tabs, resumes after page cache returns, and ignores obsolete responses after saving", async () => {
  const dom = page("/garden/write/archive");
  const { window } = dom;
  try {
    let calls = 0,
      tick,
      respond;
    window.setInterval = (callback) => {
      tick = callback;
      return 1;
    };
    window.fetch = () => {
      calls++;
      return new Promise((resolve) => {
        respond = resolve;
      });
    };
    window.PageTest.mountChanges("/garden/write");
    assert.equal(calls, 1);
    window.document.dispatchEvent(
      new window.CustomEvent("microbloggr:saved", {
        detail: { id: "one", revision: "saved" },
      }),
    );
    respond({
      ok: true,
      json: async () => ({ posts: { one: "old" }, errors: [] }),
    });
    await flush();
    const notice = window.document.querySelector("[data-change-notice]");
    assert.equal(notice.hidden, true);
    Object.defineProperty(window.document, "hidden", {
      value: true,
      configurable: true,
    });
    tick();
    assert.equal(calls, 1);
    Object.defineProperty(window.document, "hidden", {
      value: false,
      configurable: true,
    });
    window.dispatchEvent(new window.Event("pagehide"));
    tick();
    assert.equal(calls, 1);
    window.dispatchEvent(new window.Event("pageshow"));
    assert.equal(calls, 2);
    respond({
      ok: true,
      json: async () => ({
        posts: { one: "saved", other: "external" },
        errors: [],
      }),
    });
    await flush();
    assert.equal(
      notice.hidden,
      false,
      "Other changes must remain visible after acknowledging a save",
    );
    assert.match(notice.textContent, /Posts changed on disk/);
  } finally {
    window.close();
  }
});
