type Snapshot = {
  posts: Record<string, string>;
  errors: { file: string; message: string }[];
};

export function mountArchive(editorUrl: string) {
  if (location.pathname !== `${editorUrl}/archive`) return;
  const key = `microbloggr:scroll:${location.pathname}${location.search}`;
  let clickedCard: string | undefined;
  const remember = () => {
    try {
      const active = document.activeElement as HTMLElement | null;
      sessionStorage.setItem(
        key,
        JSON.stringify({
          y: window.scrollY,
          href:
            active
              ?.closest<HTMLAnchorElement>(".archive-card")
              ?.getAttribute("href") || clickedCard,
        }),
      );
    } catch {
      /* Native history restoration still works without storage. */
    }
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!location.hash && saved && Number.isFinite(saved.y) && saved.y >= 0) {
      requestAnimationFrame(() => {
        const card = [
          ...document.querySelectorAll<HTMLAnchorElement>(".archive-card"),
        ].find((link) => link.getAttribute("href") === saved.href);
        card?.focus({ preventScroll: true });
        window.scrollTo({ top: saved.y, behavior: "instant" });
      });
    }
  } catch {
    /* Ignore expired or malformed tab-local state. */
  }
  window.addEventListener("pagehide", remember);
  // Capture before navigation as well, including opening an edit in a new tab.
  document.addEventListener("click", (event) => {
    clickedCard =
      (event.target as Element)
        .closest(".archive-card")
        ?.getAttribute("href") || undefined;
    if ((event.target as Element).closest("a")) remember();
  });
}

export function mountChanges(editorUrl: string) {
  const notice = document.querySelector<HTMLElement>("[data-change-notice]");
  if (!notice) return;
  const message = notice.querySelector<HTMLElement>("[data-change-message]")!;
  const reload = notice.querySelector<HTMLAnchorElement>("a")!;
  const baseline: Snapshot = JSON.parse(document.body.dataset.collectionState!);
  let latest = baseline;
  let generation = 0;
  let stopped = false;
  let controller: AbortController | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const form = document.querySelector<HTMLFormElement>("form[data-composer]");
  const show = () => {
    const changed =
      Object.keys({ ...baseline.posts, ...latest.posts }).some(
        (id) => baseline.posts[id] !== latest.posts[id],
      ) || JSON.stringify(baseline.errors) !== JSON.stringify(latest.errors);
    let text = changed
      ? "Posts changed on disk. Reload to see the latest version."
      : "";
    const post = form ? JSON.parse(form.dataset.initial!) : null;
    if (post?.id && latest.posts[post.id] !== post.revision) {
      text = latest.errors.some(({ file }) => file === `${post.id}.md`)
        ? "This post could not be read from disk. Your edits are still here. Fix the file before saving."
        : latest.posts[post.id]
          ? "This post changed on disk. Your edits are still here. Copy unsaved changes before reloading."
          : "This post was removed from disk. Your edits are still here. Copy them before leaving.";
    }
    if (message.textContent !== text) message.textContent = text;
    notice.hidden = !text;
    reload.href = `${location.pathname}${location.search}`;
  };
  const check = async () => {
    if (
      stopped ||
      document.hidden ||
      controller ||
      form?.querySelector("fieldset")?.disabled
    )
      return;
    const current = generation;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 8000);
    try {
      const response = await fetch(`${editorUrl}/api/changes`, {
        cache: "no-store",
        signal: request.signal,
      });
      if (!response.ok) return;
      const snapshot: Snapshot = await response.json();
      if (
        stopped ||
        current !== generation ||
        form?.querySelector("fieldset")?.disabled
      )
        return;
      latest = snapshot;
      show();
    } catch {
      /* Retry when the dev server or tab becomes available again. */
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = undefined;
    }
  };
  document.addEventListener("microbloggr:saved", (event) => {
    const { id, revision } = (event as CustomEvent).detail;
    generation++;
    baseline.posts[id] = revision;
    // Acknowledge only this save; other posts may have changed concurrently.
    latest.posts[id] = revision;
    show();
  });
  window.addEventListener("focus", () => void check());
  document.addEventListener("microbloggr:check", () => void check());
  document.addEventListener("visibilitychange", () => void check());
  window.addEventListener("pagehide", () => {
    stopped = true;
    generation++;
    clearInterval(interval);
    controller?.abort();
    controller = undefined;
  });
  window.addEventListener("pageshow", () => {
    if (!stopped) return;
    stopped = false;
    interval = setInterval(() => void check(), 5000);
    void check();
  });
  interval = setInterval(() => void check(), 5000);
  void check();
}

export function mountTheme() {
  const root = document.documentElement;
  document
    .querySelector("[data-theme-toggle]")
    ?.addEventListener("click", () => {
      const dark =
        root.dataset.theme === "dark" ||
        (!root.dataset.theme &&
          matchMedia("(prefers-color-scheme: dark)").matches);
      root.dataset.theme = dark ? "light" : "dark";
      try {
        localStorage.setItem("microbloggr:theme", root.dataset.theme);
      } catch {
        /* The choice lasts for this page when storage is unavailable. */
      }
    });
}

export function mountFilters() {
  const form = document.querySelector<HTMLFormElement>(".archive-filters");
  if (!form) return;
  let leaving = false;
  const apply = () => {
    if (leaving) return;
    leaving = true;
    // Leave empty filters out so URLs stay short.
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(form))
      if (typeof value === "string" && value.trim()) params.set(name, value);
    location.assign(`${form.action}${params.size ? `?${params}` : ""}`);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply();
  });
  form.addEventListener("change", apply);
  window.addEventListener("pageshow", () => (leaving = false));
}

// The editor's own writes make Astro reload the page, often after the editor
// has already moved on to the next page. Remember when this tab last wrote so
// that page can skip the reload; it refreshes through the change check.
const ownWriteKey = "microbloggr:own-write";
export function noteOwnWrite() {
  try {
    sessionStorage.setItem(ownWriteKey, String(Date.now()));
  } catch {}
}
export function wroteRecently() {
  try {
    return Date.now() - Number(sessionStorage.getItem(ownWriteKey)) < 5000;
  } catch {
    return false;
  }
}

// A just-uploaded file can 404 for a moment until the dev server notices it,
// so retry this site's images a few times before giving up.
export function retryImages() {
  const tries = new WeakMap<HTMLImageElement, number>();
  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      const url = new URL(image.src, location.href);
      const count = tries.get(image) ?? 0;
      if (url.origin !== location.origin || count >= 8) return;
      tries.set(image, count + 1);
      url.searchParams.set("retry", String(count + 1));
      setTimeout(() => (image.src = url.href), 400 * (count + 1));
    },
    true,
  );
}

// Restore or permanently delete trashed posts. Each change reloads the page
// so the list and the sidebar counts stay in step with the files.
export function mountTrash(editorUrl: string) {
  const found = document.querySelector<HTMLElement>("[data-trash]");
  if (!found) return;
  const trash: HTMLElement = found;
  const dialog = trash.querySelector<HTMLDialogElement>("[data-trash-dialog]")!;
  const notice = trash.querySelector<HTMLElement>("[data-trash-error]")!;
  const api = `${editorUrl}/api`;
  let busy = false;
  function ask(heading: string) {
    dialog.querySelector("h2")!.textContent = heading;
    dialog.showModal();
    // Answer from the button press or Esc directly, not the later close event.
    const form = dialog.querySelector("form")!;
    return new Promise<boolean>((resolve) => {
      const done = (answer: boolean) => {
        form.removeEventListener("submit", submitted);
        dialog.removeEventListener("cancel", cancelled);
        resolve(answer);
      };
      const submitted = (event: SubmitEvent) =>
        done((event.submitter as HTMLButtonElement | null)?.value === "delete");
      const cancelled = () => done(false);
      form.addEventListener("submit", submitted);
      dialog.addEventListener("cancel", cancelled);
    });
  }
  // Run one request per entry in order. Rows that succeed leave the list; on
  // full success the page reloads so the sidebar counts follow.
  async function act(method: string, items: HTMLElement[], suffix = "") {
    busy = true;
    notice.hidden = true;
    noteOwnWrite();
    const failures: string[] = [];
    try {
      const { token } = await (await fetch(`${api}/session`)).json();
      for (const item of items) {
        const response = await fetch(
          `${api}/trash/${item.dataset.trashId}${suffix}`,
          {
            method,
            headers: {
              "Content-Type": "application/json",
              "X-Microbloggr-Token": token,
            },
            body: "{}",
          },
        );
        if (response.ok) item.remove();
        else
          failures.push(
            `${title(item)}: ${(await response.json()).error ?? "Failed."}`,
          );
      }
    } catch (error) {
      failures.push((error as Error).message || "Something went wrong.");
    }
    if (!failures.length) return location.reload();
    notice.textContent = failures.join("\n");
    notice.hidden = false;
    busy = false;
    sync();
  }
  const rows = () => [
    ...trash.querySelectorAll<HTMLElement>("[data-trash-id]"),
  ];
  const checkbox = (item: HTMLElement) =>
    item.querySelector<HTMLInputElement>("[data-select]")!;
  const selected = () => rows().filter((item) => checkbox(item).checked);
  const title = (item: HTMLElement) =>
    item.querySelector(".trash-title")?.textContent ?? "post";
  const posts = (count: number) => `${count} ${count === 1 ? "post" : "posts"}`;
  // Keep select-all, the count, and the bulk buttons in step with the rows.
  function sync() {
    const all = trash.querySelector<HTMLInputElement>("[data-select-all]");
    if (!all) return;
    const count = selected().length;
    all.checked = count > 0 && count === rows().length;
    all.indeterminate = count > 0 && count < rows().length;
    trash.querySelector("[data-selected-count]")!.textContent = count
      ? `${count} selected`
      : "";
    for (const button of trash.querySelectorAll<HTMLButtonElement>(
      "[data-restore-selected], [data-delete-selected]",
    ))
      button.disabled = !count;
  }
  trash.addEventListener("change", (event) => {
    const box = event.target as HTMLInputElement;
    if (box.matches("[data-select-all]"))
      rows().forEach((item) => (checkbox(item).checked = box.checked));
    sync();
  });
  trash.addEventListener("click", async (event) => {
    const button = (event.target as Element).closest("button");
    const item = button?.closest<HTMLElement>("[data-trash-id]");
    if (!button || busy) return;
    if (item && button.matches("[data-restore]"))
      await act("POST", [item], "/restore");
    else if (item && button.matches("[data-delete-forever]")) {
      if (await ask(`Delete “${title(item)}” forever?`))
        await act("DELETE", [item]);
    } else if (button.matches("[data-restore-selected]"))
      await act("POST", selected(), "/restore");
    else if (button.matches("[data-delete-selected]")) {
      const items = selected();
      if (await ask(`Delete ${posts(items.length)} forever?`))
        await act("DELETE", items);
    }
  });
  sync();
}

export function mountPage() {
  const editorUrl = document.body.dataset.editorUrl!;
  retryImages();
  mountTrash(editorUrl);
  mountTheme();
  mountFilters();
  mountArchive(editorUrl);
  mountChanges(editorUrl);
}
