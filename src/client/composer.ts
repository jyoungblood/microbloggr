import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  richTextUnavailableReason,
  preserveBodyWhitespace,
} from "./markdown.mjs";
import config from "virtual:microbloggr";
import { editorReturn } from "../navigation.mjs";
import { noteOwnWrite } from "./page";

import { mountPhotos, type Photo } from "./photos";
import { providerEmbed, renderProvider } from "../embeds.mjs";
import { captureFrame } from "./frame";

const markdownStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--ink-2)", textDecoration: "underline" },
  { tag: [t.processingInstruction, t.meta, t.quote], color: "var(--muted)" },
]);
type SavedPost = {
  id?: string;
  revision?: string;
  body: string;
  data: {
    type: string;
    title?: string;
    tags: string[];
    status: string;
    publishedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
    photos?: Photo[];
    link?: { url: string };
    media?: { src: string; kind: string; poster?: string; embed?: string };
  };
};
// Heading buttons are named "heading-1" to "heading-3".
const headingLevel = (format?: string) =>
  Number(format?.split("-")[1]) as 1 | 2 | 3;
const isActive = (editor: Editor, format: string) =>
  format.startsWith("heading-")
    ? editor.isActive("heading", { level: headingLevel(format) })
    : editor.isActive(format);

export async function mountComposer(form: HTMLFormElement) {
  const section = form.closest<HTMLElement>(".composer")!;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    section.querySelector<T>(selector)!;
  const input = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  let saved: SavedPost = JSON.parse(form.dataset.initial!);
  const type = saved.data.type;
  const api = `${form.dataset.editorUrl}/api`;
  const returnTo = editorReturn(form.dataset.returnTo, form.dataset.editorUrl);
  let token = "";
  let busy = false;
  let dirty = false;
  let leaving = false;
  let ready = false;
  let body = saved.body;
  let tags = [...saved.data.tags];
  let photos: ReturnType<typeof mountPhotos> | undefined;
  // Picked files stay in memory, previewed through blob URLs, until a save
  // uploads them. Nothing reaches the media folder for an abandoned post.
  const staged = new Map<string, File>();
  let baseline = "";
  let publishedDisplay = "";
  let mode: "source" | "rich" = "source";
  let syncing = false;
  const error = (message: string) => {
    $(".form-error").textContent = message;
    $(".form-error").hidden = !message;
  };
  const status = (message: string) => {
    $(".form-status").textContent = message;
  };
  const value = (name: string) => input(name)?.value || "";
  const localDate = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  const state = () => ({
    body,
    tags,
    fields: Object.fromEntries(
      ["title", "source", "kind", "poster", "published"].map((name) => [
        name,
        value(name),
      ]),
    ),
    photos: photos?.snapshot(),
  });
  function remember() {
    // An empty new post has nothing to lose, so it never prompts on leave.
    dirty = JSON.stringify(state()) !== baseline && (!!saved.id || !empty());
  }
  function changed() {
    if (!ready) return;
    remember();
    status(dirty ? "Unsaved changes" : "All changes saved");
  }
  async function request(path: string, method = "GET", data?: unknown) {
    if (method !== "GET") noteOwnWrite();
    const response = await fetch(`${api}${path}`, {
      method,
      headers:
        data === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "X-Microbloggr-Token": token,
            },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }
  const history: string[] = [body];
  let position = 0,
    lastTyping = 0;
  function changeBody(next: string, record = true) {
    if (next === body) return;
    body = next;
    if (record) {
      const now = Date.now();
      if (
        lastTyping &&
        now - lastTyping < 500 &&
        position > 0 &&
        position === history.length - 1
      )
        history[position] = body;
      else {
        history.splice(position + 1);
        history.push(body);
        position++;
      }
      lastTyping = now;
    }
    changed();
  }
  const source = new EditorView({
    parent: $(".source-editor"),
    state: EditorState.create({
      doc: body,
      extensions: [
        drawSelection(),
        keymap.of(defaultKeymap),
        markdownLanguage(),
        syntaxHighlighting(markdownStyle),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": `${type === "text" ? "Post" : "Caption"} Markdown`,
          spellcheck: "true",
        }),
        EditorView.theme({
          "&": { backgroundColor: "transparent", color: "var(--ink)" },
          ".cm-content": {
            minHeight: "200px",
            padding: "14px 0",
            fontFamily: "var(--sans)",
            caretColor: "var(--ink)",
          },
          ".cm-line": { padding: "0 16px" },
          ".cm-cursor": { borderLeftColor: "var(--ink)" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
            { backgroundColor: "var(--selection)" },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing)
            changeBody(update.state.doc.toString());
        }),
      ],
    }),
  });
  const rich = new Editor({
    element: $(".rich-editor"),
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: false },
      }),
      Markdown,
    ],
    content: "",
    contentType: "markdown",
    editable: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": `${type === "text" ? "Post" : "Caption"} rich text`,
        "aria-multiline": "true",
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) {
          event.preventDefault();
          return true;
        }
        event.preventDefault();
        if (richTextUnavailableReason(text)) {
          changeBody(body.trim() ? `${body}\n\n${text}` : text);
          setMode("source");
          status(
            "Pasted content was added at the end, and the post is now edited as Markdown to preserve its syntax.",
          );
        } else rich.commands.insertContent(text, { contentType: "markdown" });
        return true;
      },
      handleDrop: () => true,
      handleDOMEvents: {
        click: (_view, event) => {
          if ((event.target as Element).closest("a")) event.preventDefault();
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      if (!syncing)
        changeBody(preserveBodyWhitespace(editor.getMarkdown(), saved.body));
    },
    onTransaction: ({ editor }) => {
      form
        .querySelectorAll<HTMLButtonElement>("[data-format]")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(isActive(editor, button.dataset.format!)),
          ),
        );
    },
  });
  source.contentDOM.contentEditable = "false";
  function syncEditors() {
    syncing = true;
    if (mode === "source")
      source.dispatch({
        changes: { from: 0, to: source.state.doc.length, insert: body },
      });
    else
      rich.commands.setContent(body, {
        contentType: "markdown",
        emitUpdate: false,
      });
    syncing = false;
  }
  function setMode(next: "source" | "rich") {
    const reason = richTextUnavailableReason(body);
    if (next === "rich" && reason) next = "source";
    mode = next;
    lastTyping = 0;
    $(".source-reason").textContent = reason || "";
    $(".source-reason").hidden = !reason;
    $(".source-editor").hidden = mode !== "source";
    $(".rich-editor").hidden = mode !== "rich";
    $(".format-toolbar").hidden = mode !== "rich";
    $(".link-editor").hidden = true;
    syncEditors();
  }
  function moveHistory(direction: number) {
    const next = position + direction;
    if (next < 0 || next >= history.length) return;
    position = next;
    lastTyping = 0;
    changeBody(history[position], false);
    if (richTextUnavailableReason(body)) setMode("source");
    else syncEditors();
  }
  form.addEventListener(
    "keydown",
    (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        (event.target as Element).closest(".rich-editor, .source-editor")
      ) {
        event.preventDefault();
        event.stopPropagation();
        moveHistory(event.shiftKey ? 1 : -1);
      }
    },
    true,
  );
  form
    .querySelectorAll<HTMLButtonElement>("[data-format]")
    .forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const chain = rich.chain().focus();
        switch (button.dataset.format) {
          case "bold":
            chain.toggleBold().run();
            break;
          case "italic":
            chain.toggleItalic().run();
            break;
          case "strike":
            chain.toggleStrike().run();
            break;
          case "heading-1":
          case "heading-2":
          case "heading-3":
            chain
              .toggleHeading({ level: headingLevel(button.dataset.format) })
              .run();
            break;
          case "bulletList":
            chain.toggleBulletList().run();
            break;
          case "orderedList":
            chain.toggleOrderedList().run();
            break;
          case "blockquote":
            chain.toggleBlockquote().run();
            break;
          case "code":
            chain.toggleCode().run();
            break;
          case "horizontalRule":
            chain.setHorizontalRule().run();
            break;
          case "link":
            $(".link-editor").hidden = false;
            $<HTMLInputElement>("#body-link").value =
              rich.getAttributes("link").href || "";
            $("#body-link").focus();
            break;
        }
      });
    });
  $('[data-link="apply"]').addEventListener("click", () => {
    const href = $<HTMLInputElement>("#body-link").value.trim();
    if (
      !/^https?:\/\//i.test(href) &&
      !/^\/(?!\/)/.test(href) &&
      !/^#[\w-]+$/.test(href)
    ) {
      error("Use an HTTP(S), site-relative, or anchor link.");
      return;
    }
    const chain = rich.chain().focus().extendMarkRange("link");
    if (rich.state.selection.empty && !rich.isActive("link"))
      chain
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    else chain.setLink({ href }).run();
    $(".link-editor").hidden = true;
    error("");
  });
  $('[data-link="remove"]').addEventListener("click", () => {
    rich.chain().focus().extendMarkRange("link").unsetLink().run();
    $(".link-editor").hidden = true;
  });
  $('[data-link="cancel"]').addEventListener("click", () => {
    $(".link-editor").hidden = true;
    rich.commands.focus();
  });
  $("#body-link").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $('[data-link="apply"]').click();
    }
  });
  function renderTags() {
    $(".tag-editor").replaceChildren(
      ...tags.map((tag, index) => {
        const li = document.createElement("li"),
          button = document.createElement("button");
        button.type = "button";
        const remove = document.createElement("span");
        remove.textContent = "×";
        remove.setAttribute("aria-hidden", "true");
        button.append(`#${tag}`, remove);
        button.setAttribute("aria-label", `Remove tag ${tag}`);
        button.addEventListener("click", () => {
          tags.splice(index, 1);
          renderTags();
          changed();
          $("#tag-entry").focus();
        });
        li.append(button);
        return li;
      }),
    );
  }
  function addTag() {
    const entry = $<HTMLInputElement>("#tag-entry");
    for (const raw of entry.value.split(",")) {
      const tag = raw.trim();
      if (
        tag &&
        tag.length <= 100 &&
        tags.length < 100 &&
        !tags.some((t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase())
      )
        tags.push(tag);
    }
    entry.value = "";
    renderTags();
    changed();
  }
  $("#tag-entry").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    }
    if (event.key === "Backspace" && !$<HTMLInputElement>("#tag-entry").value) {
      tags.pop();
      renderTags();
      changed();
    }
  });
  $("#tag-entry").addEventListener("blur", addTag);
  function dates() {
    const now = localDate(new Date().toISOString());
    // Unpublished posts show the current time; leaving it untouched lets the
    // server stamp the actual publish time.
    publishedDisplay = localDate(saved.data.publishedAt) || now;
    input("published").value = publishedDisplay;
    input("published").max = now;
  }
  function payload(publication: string) {
    const result: Record<string, unknown> = {
      type,
      status: publication,
      title: value("title"),
      body,
      tags,
      revision: saved.revision,
      publishedAt:
        value("published") === publishedDisplay
          ? saved.data.publishedAt
          : value("published")
            ? new Date(value("published")).toISOString()
            : null,
    };
    if (type === "photo") result.photos = photos!.photos();
    if (type === "link")
      result.link = value("source").trim()
        ? { url: value("source").trim() }
        : null;
    if (["audio", "video"].includes(type))
      result.media = value("source").trim()
        ? {
            src: value("source").trim(),
            kind: value("kind"),
            poster: value("poster").trim(),
          }
        : null;
    return result;
  }
  const asset = (url: string) => {
    if (staged.has(url)) return url;
    if (/^\/(?!\/)/.test(url) && !url.includes("\\"))
      return `${config.siteBase.replace(/\/$/, "")}${url}`;
    try {
      if (["http:", "https:"].includes(new URL(url).protocol)) return url;
    } catch {}
    return "";
  };
  function lock(value: boolean) {
    busy = value;
    $<HTMLFieldSetElement>("fieldset").disabled = value;
    rich.setEditable(!value, false);
    source.contentDOM.contentEditable = String(!value);
  }
  // Grab a frame from a direct video file so the post has a thumbnail.
  // Provider links get theirs from the server on save.
  async function videoThumbnail() {
    if (type !== "video" || value("kind") !== "file") return;
    const src = value("source").trim();
    const poster = value("poster").trim();
    const generated = poster.startsWith(config.thumbnailPath);
    if (!src || (poster && !(generated && src !== saved.data.media?.src)))
      return;
    const frame = await captureFrame(asset(src));
    if (!frame) {
      if (generated) input("poster").value = "";
      return;
    }
    const response = await fetch(`${api}/uploads?type=thumbnail`, {
      method: "POST",
      headers: {
        "X-Microbloggr-Token": token,
        "Content-Type": "application/octet-stream",
      },
      body: frame,
    });
    if (response.ok) input("poster").value = (await response.json()).src;
  }
  const removeDialog = section.querySelector<HTMLDialogElement>(
    "[data-remove-dialog]",
  )!;
  // The in-app "are you sure?" step before removing a photo or media file.
  function ask(message: string) {
    removeDialog.querySelector("h2")!.textContent = message;
    removeDialog.returnValue = "";
    removeDialog.showModal();
    // Answer from the button press or Esc directly, not the later close event.
    const dialogForm = removeDialog.querySelector("form")!;
    return new Promise<boolean>((resolve) => {
      const done = (answer: boolean) => {
        dialogForm.removeEventListener("submit", submitted);
        removeDialog.removeEventListener("cancel", cancelled);
        resolve(answer);
      };
      const submitted = (event: SubmitEvent) =>
        done((event.submitter as HTMLButtonElement | null)?.value === "remove");
      const cancelled = () => done(false);
      dialogForm.addEventListener("submit", submitted);
      removeDialog.addEventListener("cancel", cancelled);
    });
  }
  const mediaField = form.querySelector<HTMLElement>("[data-media-field]");
  const picker = form.querySelector<HTMLElement>("[data-media-picker]");
  const urlRow = form.querySelector<HTMLElement>("[data-media-url]");
  const announce = (message: string) => {
    const region = form.querySelector("[data-media-status]");
    if (region) region.textContent = message;
  };
  const bandcampPage = (url: string) =>
    /^https:\/\/[a-z0-9-]+\.bandcamp\.com\/(album|track)\//i.test(url);
  // Provider links stay embedded players; any other link is a file to download.
  const providerLink = (url: string) =>
    !!providerEmbed(url, type) || (type === "audio" && bandcampPage(url));
  function syncPicker() {
    if (!picker) return;
    if (photos) {
      // With photos attached, the picker becomes one "add more" dropzone.
      const more = photos.count() > 0;
      picker.classList.toggle("compact", more);
      $("[data-upload-label]").textContent = more
        ? "Add more photos"
        : "Upload photos";
      if (more) urlRow!.hidden = true;
      picker.hidden = !urlRow!.hidden;
    } else picker.hidden = !!value("source").trim() || !urlRow!.hidden;
  }
  // Show the current video or audio: a player for files, the provider's player
  // for links. Removing it brings the picker back.
  function showMedia() {
    const current = form.querySelector<HTMLElement>("[data-media-current]");
    if (!current) return;
    const src = value("source").trim();
    const stage = $("[data-media-stage]");
    current.hidden = !src;
    if (!src) stage.replaceChildren();
    else if (value("kind") === "embed") {
      const embed =
        src === saved.data.media?.src ? saved.data.media?.embed : undefined;
      if (bandcampPage(src) && !embed) {
        const note = document.createElement("p");
        note.className = "media-link";
        note.textContent = `${src} (the player is set up when you save)`;
        stage.replaceChildren(note);
      } else stage.innerHTML = renderProvider(embed ?? src, type);
    } else {
      const player = document.createElement(
        type === "video" ? "video" : "audio",
      );
      player.controls = true;
      player.preload = "metadata";
      player.src = asset(src);
      stage.replaceChildren(player);
    }
    syncPicker();
  }
  function setMedia(src: string, kind: "file" | "embed") {
    const old = input("source").value;
    if (staged.has(old)) unstage(old);
    input("source").value = src;
    input("kind").value = kind;
    // A new source gets a new thumbnail on save.
    input("poster").value = "";
    showMedia();
    changed();
  }
  function addFiles(files: File[]) {
    if (!files.length || busy || !ready) return;
    if (type !== "photo" && files.length !== 1) {
      error(`Choose one ${type} file.`);
      return;
    }
    if (photos && photos.count() + files.length > 100) {
      error("Use at most 100 photos per post. Choose fewer files.");
      return;
    }
    error("");
    for (const file of files) {
      const url = URL.createObjectURL(file);
      staged.set(url, file);
      if (photos) photos.add(url);
      else setMedia(url, "file");
    }
    announce(
      `${files.length} ${type === "photo" ? `photo${files.length > 1 ? "s" : ""}` : type} added. ${files.length > 1 ? "They upload" : "It uploads"} when you save.`,
    );
  }
  function addUrl() {
    const field = $<HTMLInputElement>("#media-url");
    const link = field.value.trim();
    try {
      if (!["http:", "https:"].includes(new URL(link).protocol)) throw 0;
    } catch {
      error("Paste an http or https link.");
      field.focus();
      return;
    }
    if (photos && photos.count() >= 100) {
      error("Use at most 100 photos per post.");
      return;
    }
    error("");
    if (photos) photos.add(link);
    else setMedia(link, providerLink(link) ? "embed" : "file");
    showUrlPanel(false);
  }
  function unstage(url: string) {
    URL.revokeObjectURL(url);
    staged.delete(url);
  }
  // On save, picked files upload and pasted file links download into the
  // media folder. Provider links stay as links.
  async function storeMedia() {
    const sources = photos
      ? photos.photos().map((photo) => photo.src)
      : [value("source").trim()].filter(Boolean);
    for (const url of staged.keys()) if (!sources.includes(url)) unstage(url);
    const pending = sources.filter(
      (src) =>
        staged.has(src) ||
        (/^https?:/i.test(src) && (photos || value("kind") === "file")),
    );
    const failures: string[] = [];
    for (const [index, src] of pending.entries()) {
      const file = staged.get(src);
      const name = file?.name ?? src;
      status(
        `${file ? "Uploading" : "Downloading"} ${index + 1} of ${pending.length}: ${name}…`,
      );
      try {
        const response = file
          ? await fetch(`${api}/uploads?type=${type}`, {
              method: "POST",
              headers: {
                "X-Microbloggr-Token": token,
                "Content-Type": "application/octet-stream",
              },
              body: file,
            })
          : await fetch(`${api}/imports`, {
              method: "POST",
              headers: {
                "X-Microbloggr-Token": token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ type, url: src }),
            });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (photos) photos.swap(src, result.src);
        else input("source").value = result.src;
        // Photos keep the preview URL alive for display; the file is sent.
        if (file && photos) staged.delete(src);
        else if (file) unstage(src);
      } catch (e) {
        failures.push(`${name}: ${(e as Error).message || "Upload failed."}`);
      }
    }
    if (failures.length)
      throw new Error(`${failures.join("\n")}\nRemove these, then save again.`);
  }
  if (type === "photo")
    photos = mountPhotos(mediaField!, saved.data.photos ?? [], {
      changed: () => {
        syncPicker();
        changed();
      },
      busy: () => busy || !ready,
      asset,
      confirm: ask,
      announce,
    });
  form
    .querySelector("[data-media-remove]")
    ?.addEventListener("click", async () => {
      if (busy || !(await ask(`Remove this ${type}?`))) return;
      setMedia("", "file");
      announce(`${type === "video" ? "Video" : "Audio"} removed.`);
      form.querySelector<HTMLElement>("[data-pick-upload]")?.focus();
    });
  form
    .querySelector("[data-pick-upload]")
    ?.addEventListener("click", () => $<HTMLInputElement>("#upload").click());
  // "From web" swaps the picker for the link panel; Esc swaps back.
  function showUrlPanel(show: boolean) {
    urlRow!.hidden = !show;
    picker!.hidden = show;
    if (show) $("#media-url").focus();
    else {
      $<HTMLInputElement>("#media-url").value = "";
      syncPicker();
    }
  }
  form
    .querySelector("[data-pick-web]")
    ?.addEventListener("click", () => showUrlPanel(true));
  form.querySelector("[data-url-add]")?.addEventListener("click", addUrl);
  form.querySelector("#media-url")?.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Enter") {
      event.preventDefault();
      addUrl();
    } else if (key === "Escape") {
      showUrlPanel(false);
      form.querySelector<HTMLElement>("[data-pick-web]")?.focus();
    }
  });
  $<HTMLInputElement>("#upload")?.addEventListener("change", (event) => {
    addFiles(Array.from((event.target as HTMLInputElement).files ?? []));
    (event.target as HTMLInputElement).value = "";
  });
  // The whole media area is a dropzone; reordering photos is a separate drag.
  const fileDrag = (event: DragEvent) =>
    !busy &&
    !photos?.dragging() &&
    !!event.dataTransfer?.types.includes("Files");
  mediaField?.addEventListener("dragover", (event) => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    mediaField.classList.add("drag-over");
  });
  mediaField?.addEventListener("dragleave", (event) => {
    if (!mediaField.contains(event.relatedTarget as Node))
      mediaField.classList.remove("drag-over");
  });
  mediaField?.addEventListener("drop", (event) => {
    mediaField.classList.remove("drag-over");
    if (!fileDrag(event)) return;
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  });
  showMedia();
  syncPicker();
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      busy ||
      document.querySelector("dialog[open]")
    )
      return;
    if (!$(".link-editor").hidden) {
      $('[data-link="cancel"]').click();
      return;
    }
    // Esc in a field only leaves the field; a second Esc closes the form.
    const field = (event.target as HTMLElement).closest?.<HTMLElement>(
      // Text entry only: Esc on a button, checkbox, or file picker closes.
      "input:not([type=file], [type=checkbox], [type=radio], [type=button], [type=submit], [type=reset]), textarea, [contenteditable='true']",
    );
    if (field) {
      field.blur();
      return;
    }
    if (event.defaultPrevented) return;
    // Closing is a link, so unsaved edits still get the leave-page prompt.
    $<HTMLAnchorElement>("[data-close]").click();
  });
  // Enter in a text field would otherwise submit with the first button,
  // which publishes. Saving always takes an explicit button press.
  form.addEventListener("keydown", (event) => {
    const target = event.target as HTMLInputElement;
    if (
      event.key === "Enter" &&
      target.tagName === "INPUT" &&
      !["checkbox", "file"].includes(target.type)
    )
      event.preventDefault();
  });
  form.addEventListener("input", changed);
  form.addEventListener("change", changed);
  async function refreshFeed() {
    const response = await fetch(form.dataset.editorUrl!);
    if (!response.ok) return;
    const documentCopy = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    for (const selector of [
      ".feed",
      ".collection-summary",
      ".sidebar-tags",
      ".pagination",
    ]) {
      const current = document.querySelector(selector),
        replacement = documentCopy.querySelector(selector);
      if (current && replacement) current.replaceWith(replacement);
      else if (selector === ".pagination" && current) current.remove();
      else if (
        selector === ".pagination" &&
        replacement &&
        document.querySelector(".feed")
      )
        document.querySelector(".feed")?.after(replacement);
    }
    if (document.querySelector(".feed > .post-card"))
      document.querySelector(".main-column > .empty-state")?.remove();
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    addTag();
    error("");
    const publication =
      (event.submitter as HTMLButtonElement)?.value || saved.data.status;
    // An untouched new post has nothing worth keeping as a draft.
    if (!saved.id && publication === "draft" && empty()) {
      close();
      return;
    }
    const photoError = photos?.validate(publication === "published");
    if (photoError) {
      error(photoError);
      return;
    }
    lock(true);
    status("Saving…");
    const editing = !!saved.id;
    try {
      await storeMedia();
      // A missing thumbnail never blocks a save.
      await videoThumbnail().catch(() => {});
      const result: SavedPost = await request(
        saved.id ? `/posts/${saved.id}` : "/posts",
        saved.id ? "PUT" : "POST",
        payload(publication),
      );
      saved = result;
      photos?.saved(saved.data.photos ?? []);
      syncPicker();
      // The server may add or drop a generated thumbnail.
      if (input("poster"))
        input("poster").value = saved.data.media?.poster ?? "";
      form.dataset.initial = JSON.stringify(saved);
      dates();
      baseline = JSON.stringify(state());
      dirty = false;
      // Saving an existing post returns to the page the edit started from.
      if (editing) {
        leave($<HTMLAnchorElement>("[data-close]").href);
        return;
      }
      $("[data-delete]").hidden = false;
      // Published posts have no "move to draft" action.
      $('[name="action"][value="draft"]').hidden = publication === "published";
      $('[name="action"][value="published"]').textContent =
        publication === "published" ? "Save changes" : "Publish";
      $("#composer-heading").textContent =
        `Edit ${type === "text" ? "post" : type}`;
      $<HTMLAnchorElement>("[data-close]").href =
        returnTo || `${form.dataset.editorUrl}/posts/${saved.id}`;
      historyReplace(
        `${form.dataset.editorUrl}/posts/${saved.id}/edit${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
      );
      document.dispatchEvent(
        new CustomEvent("microbloggr:saved", {
          detail: { id: saved.id, revision: saved.revision },
        }),
      );
      status(
        publication === "published"
          ? "Published locally. Deploy your site to update it online."
          : "Draft saved",
      );
      void refreshFeed().catch(() => {});
    } catch (e) {
      error((e as Error).message || "Save failed. Your edits are still here.");
      status("Not saved");
    } finally {
      lock(false);
    }
  });
  function empty() {
    return (
      !body.trim() &&
      !tags.length &&
      !photos?.count() &&
      ["title", "source", "poster"].every((name) => !value(name).trim())
    );
  }
  // Leave without the unsaved-changes prompts; used once nothing is at risk.
  function leave(url: string) {
    leaving = true;
    dirty = false;
    location.replace(url);
  }
  function close() {
    leave($<HTMLAnchorElement>("[data-close]").href);
  }
  const deleteDialog = section.querySelector<HTMLDialogElement>(
    "[data-delete-dialog]",
  )!;
  $("[data-delete]").addEventListener("click", () => {
    if (busy || !saved.id) return;
    deleteDialog.returnValue = "";
    deleteDialog.showModal();
  });
  deleteDialog.addEventListener("close", async () => {
    if (deleteDialog.returnValue !== "delete" || busy || !saved.id) return;
    lock(true);
    error("");
    try {
      await request(`/posts/${saved.id}`, "DELETE", {
        revision: saved.revision,
      });
      // Replace so Back doesn't return to the deleted post's edit page.
      leave(form.dataset.editorUrl!);
    } catch (e) {
      error((e as Error).message);
      lock(false);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!leaving && (dirty || busy)) {
      event.preventDefault();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const link = (event.target as Element).closest("a");
    if (
      !link ||
      link.target === "_blank" ||
      link.getAttribute("href")?.startsWith("#") ||
      leaving ||
      (!dirty && !busy)
    )
      return;
    if (!confirm("Leave this form? Your unsaved changes will be lost."))
      event.preventDefault();
    else dirty = false;
  });
  function historyReplace(url: string) {
    window.history.replaceState({}, "", url);
  }
  try {
    const session = await request("/session");
    token = session.token;
    dates();
    renderTags();
    baseline = JSON.stringify(state());
    setMode(richTextUnavailableReason(body) ? "source" : "rich");
    ready = true;
    lock(false);
    remember();
    status(saved.id ? "All changes saved" : "New draft");
  } catch (e) {
    error(`Could not load the editor. ${(e as Error).message}`);
    status("Reload to try again");
  }
}
