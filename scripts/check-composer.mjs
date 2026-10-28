import { checkPhotos } from "./check-photos.mjs";
// DOM behavior checks without launching a browser or making visual assertions.
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
export async function checkComposer(origin, editor, base, html) {
  const compiled = await build({
    stdin: {
      contents: `export { mountComposer } from './src/client/composer.ts'; export { mountPage } from './src/client/page.ts'; export { EditorView } from '@codemirror/view';`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "ComposerTest",
    platform: "browser",
    plugins: [
      {
        name: "test-config",
        setup(build) {
          build.onResolve({ filter: /^virtual:microbloggr$/ }, () => ({
            path: "config",
            namespace: "test",
          }));
          build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents: `export default ${JSON.stringify({ editorUrl: editor, siteBase: base || "/" })};`,
          }));
        },
      },
    ],
  });
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (error) => {
    if (!error.message.includes("navigation")) errors.push(error);
  });
  const dom = new JSDOM(html, {
    url: `${origin}${editor}?type=text`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  // Node fetch requires its own AbortSignal, rather than jsdom's DOM signal.
  window.AbortController = AbortController;
  window.fetch = (url, options) => fetch(new URL(url, origin), options);
  window.confirm = () => true;
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
  });
  window.eval(compiled.outputFiles[0].text);
  const form = window.document.querySelector("form[data-composer]");
  const returnTo = `${editor}/archive?type=text&page=2`;
  form.dataset.returnTo = returnTo;
  const q = (selector) => form.querySelector(selector);
  const set = (name, value) => {
    form.elements.namedItem(name).value = value;
    form.elements
      .namedItem(name)
      .dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(
      `Timed out: ${window.document.querySelector(".form-error").textContent}`,
    );
  };
  try {
    window.ComposerTest.mountPage();
    await window.ComposerTest.mountComposer(form);
    assert.equal(q("fieldset").disabled, false);
    // The body is always edited as rich text; there is no mode toggle.
    assert.equal(q("[data-mode]"), null);
    assert.equal(q("[data-history]"), null);
    assert.equal(q(".rich-editor").hidden, false);
    const rich = q(".rich-editor .ProseMirror").editor;
    const source = window.ComposerTest.EditorView.findFromDOM(q(".cm-editor"));
    const key = (shiftKey) =>
      q(".rich-editor .ProseMirror").dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    rich.commands.setContent("# Hello\n\n**Bold** body\n", {
      contentType: "markdown",
    });
    assert.match(q(".rich-editor").innerHTML, /<strong>Bold<\/strong>/);
    // Ctrl+Z and Ctrl+Shift+Z still step through the body history.
    key(false);
    assert.doesNotMatch(q(".rich-editor").innerHTML, /<strong>/);
    key(true);
    assert.match(q(".rich-editor").innerHTML, /<strong>Bold<\/strong>/);
    key(false);
    // Markdown that rich text cannot represent falls back to source editing.
    const paste = new window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    paste.clipboardData = {
      getData: (format) =>
        format === "text/plain" ? "![keep](/photo.png)\n" : "",
      types: ["text/plain"],
    };
    q(".rich-editor .ProseMirror").dispatchEvent(paste);
    assert.equal(q(".source-editor").hidden, false);
    assert.equal(q(".rich-editor").hidden, true);
    assert.equal(source.state.doc.toString(), "![keep](/photo.png)\n");
    set("title", "DOM saved post");
    q("#tag-entry").value = " Notes ,notes,Music";
    q("#tag-entry").dispatchEvent(new window.Event("blur"));
    assert.equal(q(".tag-editor").children.length, 2);
    form.dispatchEvent(
      new window.SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: q('[value="draft"]'),
      }),
    );
    await wait(
      () =>
        !q("fieldset").disabled && window.location.pathname.includes("/posts/"),
    );
    const id = window.location.pathname.split("/").at(-2);
    const saved = await (
      await fetch(`${origin}${editor}/api/posts/${id}`)
    ).json();
    assert.equal(saved.body, "![keep](/photo.png)\n");
    assert.deepEqual(saved.data.tags, ["Notes", "Music"]);
    assert.equal(saved.data.status, "draft");
    assert.equal(
      new URL(window.location.href).searchParams.get("returnTo"),
      returnTo,
    );
    assert.equal(
      window.document.querySelector("[data-close]").getAttribute("href"),
      returnTo,
    );
    window.dispatchEvent(new window.Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      window.document.querySelector("[data-change-notice]").hidden,
      true,
      "Own saves should not appear as external edits",
    );
    const { token } = await (
      await fetch(`${origin}${editor}/api/session`)
    ).json();
    // A stale form must retain local edits and show the server's conflict message.
    await fetch(`${origin}${editor}/api/posts/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Microbloggr-Token": token,
      },
      body: JSON.stringify({
        ...saved.data,
        title: "External edit",
        body: saved.body,
        revision: saved.revision,
      }),
    });
    set("title", "Keep this unsaved title");
    window.dispatchEvent(new window.Event("focus"));
    await wait(
      () => !window.document.querySelector("[data-change-notice]").hidden,
    );
    assert.match(
      window.document.querySelector("[data-change-message]").textContent,
      /This post changed on disk/,
    );
    assert.equal(
      form.elements.namedItem("title").value,
      "Keep this unsaved title",
    );
    assert.equal(source.state.doc.toString(), "![keep](/photo.png)\n");
    assert.equal(
      JSON.parse(form.dataset.initial).revision,
      saved.revision,
      "Notifications must not acknowledge a stale form revision",
    );
    form.dispatchEvent(
      new window.SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: q('[value="draft"]'),
      }),
    );
    await wait(() => !window.document.querySelector(".form-error").hidden);
    assert.match(
      window.document.querySelector(".form-error").textContent,
      /changed on disk/,
    );
    assert.equal(
      form.elements.namedItem("title").value,
      "Keep this unsaved title",
    );
    const current = await (
      await fetch(`${origin}${editor}/api/posts/${id}`)
    ).json();
    await fetch(`${origin}${editor}/api/posts/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Microbloggr-Token": token,
      },
      body: JSON.stringify({ revision: current.revision }),
    });
    window.dispatchEvent(new window.Event("focus"));
    await wait(() =>
      window.document
        .querySelector("[data-change-message]")
        .textContent.includes("removed from disk"),
    );
    assert.deepEqual(
      errors.map((e) => e.message),
      [],
    );
    console.log(
      `PASS composer DOM: rich text, Markdown fallback, undo/redo, tags, save, and conflict recovery: ${editor}`,
    );
  } finally {
    window.close();
  }
  await checkPhotos(origin, editor, compiled.outputFiles[0].text);
}
