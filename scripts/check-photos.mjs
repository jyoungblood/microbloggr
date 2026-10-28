import { JSDOM, VirtualConsole } from "jsdom";
import assert from "node:assert/strict";

// Real rendered forms and save endpoints; upload responses are controlled here.
// The HTTP integration suite separately checks real upload bytes and signatures.
export async function checkPhotos(origin, editor, compiled) {
  const api = `${origin}${editor}/api`;
  const { token } = await (await fetch(`${api}/session`)).json();
  const headers = {
    "Content-Type": "application/json",
    "X-Microbloggr-Token": token,
  };
  const response = await fetch(`${api}/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "photo",
      status: "draft",
      body: "Imported caption",
      tags: [],
      photos: [
        {
          id: "imported-first",
          src: "/first.jpg",
          imported: { sourceId: "123" },
        },
        {
          id: "imported-second",
          src: "/second.jpg",
          caption: "Retained",
        },
      ],
    }),
  });
  assert.equal(response.ok, true);
  const post = await response.json();
  const url = `${origin}${editor}/posts/${post.id}/edit`;
  const errors = [];
  const uploaded = [];
  const imported = [];
  const windows = [];
  const prompts = [];
  let dom, window, form;
  const tiles = () => [...form.querySelectorAll("[data-photo]")];
  const ids = () => tiles().map((item) => item.dataset.photo);
  const sources = () => tiles().map((item) => item.querySelector("img").src);
  const paths = () => tiles().map((item) => item.dataset.src);
  const q = (selector) => form.querySelector(selector);
  const errorText = () =>
    window.document.querySelector(".form-error").textContent;
  const wait = async (predicate, tries = 150) => {
    for (let i = 0; i < tries; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`Photo editor timed out: ${errorText()}`);
  };
  const submit = (status) =>
    form.dispatchEvent(
      new window.SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: q(`[value="${status}"]`),
      }),
    );
  const save = async (status) => {
    const revision = JSON.parse(form.dataset.initial).revision;
    submit(status);
    await wait(
      () =>
        JSON.parse(form.dataset.initial).revision !== revision &&
        !q("fieldset").disabled,
    );
    return (await fetch(`${api}/posts/${post.id}`)).json();
  };
  const files = (names) =>
    names.map(
      (name) => new window.File(["photo"], name, { type: "image/png" }),
    );
  const choose = (names) => {
    const control = q("#upload");
    Object.defineProperty(control, "files", {
      configurable: true,
      value: files(names),
    });
    control.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  // Answer the in-app "Remove this photo?" dialog.
  const answer = (value) => {
    const dialog = window.document.querySelector("[data-remove-dialog]");
    assert.equal(dialog.open, true);
    dialog.open = false;
    dialog.querySelector("form").dispatchEvent(
      new window.SubmitEvent("submit", {
        cancelable: true,
        submitter: dialog.querySelector(`[value="${value}"]`),
      }),
    );
  };
  const removeTile = async (index, value = "remove") => {
    tiles()[index].querySelector("[data-photo-remove]").click();
    answer(value);
    await new Promise((resolve) => setTimeout(resolve));
  };
  const key = (target, init) =>
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  async function open(page = url) {
    dom?.window.close();
    const html = await (await fetch(page)).text();
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => {
      // jsdom cannot navigate or play media; everything else is a failure.
      if (!/navigation|HTMLMediaElement/.test(error.message))
        errors.push(error.message);
    });
    dom = new JSDOM(html, {
      url: page,
      runScripts: "outside-only",
      pretendToBeVisual: true,
      virtualConsole,
    });
    window = dom.window;
    windows.push(window);
    window.confirm = (message) => {
      prompts.push(message);
      return true;
    };
    // jsdom has no modal dialogs or blob URLs.
    window.HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    window.URL.createObjectURL = (file) => `blob:${origin}/${file.name}`;
    window.URL.revokeObjectURL = () => {};
    window.fetch = async (input, options) => {
      const target = new URL(input, origin);
      if (target.pathname.endsWith("/uploads")) {
        uploaded.push(options.body.name);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const failed = options.body.name === "bad.png";
        return new Response(
          JSON.stringify(
            failed
              ? { error: "Unsupported photo file." }
              : { src: `/uploads/${options.body.name}` },
          ),
          { status: failed ? 400 : 200 },
        );
      }
      if (target.pathname.endsWith("/imports")) {
        const { url: link } = JSON.parse(options.body);
        imported.push(link);
        return new Response(
          JSON.stringify({ src: `/imports/${link.split("/").at(-1)}` }),
          { status: 201 },
        );
      }
      return fetch(target, options);
    };
    window.Range.prototype.getClientRects = () => [];
    window.Range.prototype.getBoundingClientRect = () => ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
    });
    window.eval(compiled);
    form = window.document.querySelector("form[data-composer]");
    await window.ComposerTest.mountComposer(form);
    assert.equal(q("fieldset").disabled, false);
  }
  try {
    await open();
    assert.deepEqual(ids(), ["imported-first", "imported-second"]);
    assert.equal(q("#upload").multiple, true);
    // With photos attached, the picker is the compact "add more" strip.
    assert.equal(q("[data-media-picker]").classList.contains("compact"), true);
    assert.equal(
      form.querySelector("[data-photo-alt], [data-photo-decorative]"),
      null,
    );

    // Alt+arrow keys reorder; the first photo is the cover.
    key(tiles()[1], { key: "ArrowLeft", altKey: true });
    assert.deepEqual(ids(), ["imported-second", "imported-first"]);
    assert.equal(window.document.activeElement, tiles()[0]);

    // Picked files and pasted links are staged, not sent, until a save.
    choose(["one.png", "bad.png", "two.png"]);
    q("[data-pick-web]").click();
    // The link panel takes the picker's place.
    assert.equal(q("[data-media-url]").hidden, false);
    assert.equal(q("[data-media-picker]").hidden, true);
    q("#media-url").value = "https://example.com/web.png";
    key(q("#media-url"), { key: "Enter" });
    assert.equal(q("[data-media-url]").hidden, true);
    assert.deepEqual(uploaded, []);
    assert.deepEqual(imported, []);
    assert.equal(tiles().length, 6);
    assert.deepEqual(sources().slice(2), [
      `blob:${origin}/one.png`,
      `blob:${origin}/bad.png`,
      `blob:${origin}/two.png`,
      "https://example.com/web.png",
    ]);
    q("#media-url").value = "not a link";
    q("[data-pick-web]").click();
    q("[data-url-add]").click();
    assert.match(errorText(), /http or https/);
    // Esc in the link field brings the picker back.
    key(q("#media-url"), { key: "Escape" });
    assert.equal(q("[data-media-url]").hidden, true);
    assert.equal(q("[data-media-picker]").hidden, false);

    // A failed upload stops the save; the rest keep their new paths.
    submit("draft");
    await wait(
      () =>
        !q("fieldset").disabled &&
        !window.document.querySelector(".form-error").hidden,
    );
    assert.deepEqual(uploaded, ["one.png", "bad.png", "two.png"]);
    assert.deepEqual(imported, ["https://example.com/web.png"]);
    assert.match(errorText(), /bad\.png/);
    // Uploaded tiles keep showing their preview; their stored paths changed.
    assert.deepEqual(paths().slice(2), [
      "/uploads/one.png",
      `blob:${origin}/bad.png`,
      "/uploads/two.png",
      "/imports/web.png",
    ]);
    assert.equal(sources()[2], `blob:${origin}/one.png`);

    // Removing asks first; cancelling keeps the photo.
    await removeTile(3, "cancel");
    assert.equal(tiles().length, 6);
    await removeTile(3);
    assert.equal(tiles().length, 5);
    let saved = await save("draft");
    assert.deepEqual(
      saved.data.photos.map((photo) => photo.src),
      [
        "/second.jpg",
        "/first.jpg",
        "/uploads/one.png",
        "/uploads/two.png",
        "/imports/web.png",
      ],
    );
    assert.deepEqual(saved.data.photos.map((photo) => photo.id).slice(0, 2), [
      "imported-second",
      "imported-first",
    ]);
    assert.equal(saved.data.photos[0].caption, "Retained");
    assert.deepEqual(saved.data.photos[1].imported, { sourceId: "123" });
    assert.ok(saved.data.photos.every((photo) => !("alt" in photo)));
    assert.equal(uploaded.length, 3, "saved files are not uploaded again");

    // Dragging a tile reorders the grid.
    await open();
    const transfer = {
      setData() {},
      effectAllowed: "",
      dropEffect: "",
      types: [],
    };
    const drag = (target, type) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      target.dispatchEvent(event);
    };
    const last = ids().at(-1);
    drag(tiles().at(-1), "dragstart");
    drag(tiles()[0], "dragover");
    drag(tiles()[0], "drop");
    drag(tiles()[0], "dragend");
    assert.equal(ids()[0], last);

    // Removing every photo brings back the full picker; publishing needs one.
    while (tiles().length) await removeTile(0);
    assert.equal(q("[data-media-picker]").classList.contains("compact"), false);
    submit("published");
    assert.match(errorText(), /Add a photo/);
    saved = await save("draft");
    assert.deepEqual(saved.data.photos, []);

    // Dropping files anywhere on the media area adds them.
    const drop = new window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: files(["drop.png"]), types: ["Files"] },
    });
    q("[data-media-field]").dispatchEvent(drop);
    assert.deepEqual(sources(), [`blob:${origin}/drop.png`]);

    // A full gallery rejects more files before any upload.
    const current = await (await fetch(`${api}/posts/${post.id}`)).json();
    const full = await fetch(`${api}/posts/${post.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        ...current.data,
        body: current.body,
        revision: current.revision,
        photos: Array.from({ length: 100 }, (_, i) => ({
          id: `full-${i}`,
          src: `/full-${i}.png`,
        })),
      }),
    });
    assert.equal(full.ok, true, await full.clone().text());
    await open();
    const uploadCount = uploaded.length;
    choose(["overflow.png"]);
    assert.equal(uploaded.length, uploadCount);
    assert.equal(tiles().length, 100);
    assert.match(errorText(), /100 photos/);

    // Video: a provider link embeds, removing it returns to the picker, and a
    // picked file uploads on save.
    await open(`${origin}${editor}?type=video`);
    assert.equal(q("[data-media-current]").hidden, true);
    q("[data-pick-web]").click();
    assert.equal(q("[data-url-add]").textContent.trim(), "Add");
    assert.equal(q('label[for="media-url"]').textContent.trim(), "Video URL");
    q("#media-url").value = "https://vimeo.com/76979871";
    q("[data-url-add]").click();
    assert.equal(q("#media-kind").value, "embed");
    assert.equal(q("[data-media-picker]").hidden, true);
    assert.match(q("[data-media-stage]").innerHTML, /player\.vimeo\.com/);
    q("[data-media-remove]").click();
    answer("remove");
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(q("#source").value, "");
    assert.equal(q("[data-media-picker]").hidden, false);
    assert.equal(q("[data-media-current]").hidden, true);
    q("#upload").multiple = false;
    const before = uploaded.length;
    choose(["clip.mp4"]);
    assert.equal(q("#media-kind").value, "file");
    assert.ok(q("[data-media-stage] video"));
    assert.equal(uploaded.length, before);
    submit("draft");
    // jsdom cannot decode video, so the thumbnail capture waits out its timeout.
    await wait(() => window.location.pathname.includes("/posts/"), 600);
    assert.deepEqual(uploaded.slice(before), ["clip.mp4"]);
    const videoId = window.location.pathname.split("/").at(-2);
    const video = await (await fetch(`${api}/posts/${videoId}`)).json();
    assert.deepEqual(video.data.media, {
      src: "/uploads/clip.mp4",
      kind: "file",
    });
    await fetch(`${api}/posts/${videoId}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ revision: video.revision }),
    });

    assert.deepEqual(errors, []);
    assert.equal(
      prompts.some((message) => /restore/i.test(message)),
      false,
    );
    console.log(
      `PASS media pickers, staging, links, reorder, removal, failures, limits, and saves: ${editor}`,
    );
  } finally {
    windows.forEach((item) => item.close());
    const current = await (await fetch(`${api}/posts/${post.id}`)).json();
    await fetch(`${api}/posts/${post.id}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ revision: current.revision }),
    });
  }
}
