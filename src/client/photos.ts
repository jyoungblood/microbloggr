export type Photo = {
  id?: string;
  src: string;
  [key: string]: unknown;
};
type Entry = Photo & { id: string };

// The photo grid: thumbnails in display order, dragged to reorder, each with
// a remove button. Adding files and links happens in the composer.
export function mountPhotos(
  root: HTMLElement,
  initial: Photo[],
  options: {
    changed: () => void;
    busy: () => boolean;
    asset: (src: string) => string;
    confirm: (message: string) => Promise<boolean>;
    announce: (message: string) => void;
  },
) {
  const list = root.querySelector<HTMLOListElement>("[data-photos]")!;
  const template = root.querySelector<HTMLTemplateElement>(
    "[data-photo-template]",
  )!;
  const entry = (photo: Photo): Entry => ({
    ...photo,
    id: photo.id ?? crypto.randomUUID(),
  });
  let entries = initial.map(entry);
  // An uploaded photo keeps showing its in-memory preview, so the grid does
  // not flicker while the dev server picks up the new file.
  const shown = new Map<string, string>();
  let dragged: string | undefined;
  const tile = (id: string) =>
    [...list.querySelectorAll<HTMLElement>("[data-photo]")].find(
      (item) => item.dataset.photo === id,
    );
  function move(id: string, to: number) {
    const from = entries.findIndex((photo) => photo.id === id);
    if (from < 0 || to < 0 || to >= entries.length || from === to) return;
    entries.splice(to, 0, entries.splice(from, 1)[0]);
    render();
    tile(id)?.focus();
    options.announce(`Photo moved to position ${to + 1} of ${entries.length}.`);
    options.changed();
  }
  async function remove(id: string) {
    if (options.busy() || !(await options.confirm("Remove this photo?")))
      return;
    const index = entries.findIndex((photo) => photo.id === id);
    if (index < 0) return;
    entries.splice(index, 1);
    render();
    const next = entries[Math.min(index, entries.length - 1)];
    if (next) tile(next.id)?.focus();
    options.announce(`Photo ${index + 1} removed.`);
    options.changed();
  }
  const position = (id: string) =>
    entries.findIndex((photo) => photo.id === id);
  function render() {
    list.replaceChildren(
      ...entries.map((photo, index) => {
        const item = template.content.firstElementChild!.cloneNode(
          true,
        ) as HTMLElement;
        item.dataset.photo = photo.id;
        item.dataset.src = photo.src;
        item.setAttribute(
          "aria-label",
          `Photo ${index + 1} of ${entries.length}${index === 0 ? ", cover" : ""}. Alt and arrow keys reorder; Delete removes.`,
        );
        const image = item.querySelector("img")!;
        image.src = shown.get(photo.src) ?? options.asset(photo.src);
        item
          .querySelector("[data-photo-remove]")!
          .addEventListener("click", () => void remove(photo.id));
        item.addEventListener("keydown", (event) => {
          if (event.target !== item) return;
          if (event.altKey && ["ArrowLeft", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            move(photo.id, position(photo.id) - 1);
          } else if (
            event.altKey &&
            ["ArrowRight", "ArrowDown"].includes(event.key)
          ) {
            event.preventDefault();
            move(photo.id, position(photo.id) + 1);
          } else if (["Delete", "Backspace"].includes(event.key)) {
            event.preventDefault();
            void remove(photo.id);
          }
        });
        item.addEventListener("dragstart", (event) => {
          if (options.busy() || !event.dataTransfer) {
            event.preventDefault();
            return;
          }
          dragged = photo.id;
          list.dataset.dragStart = String(position(photo.id));
          event.dataTransfer.setData("text/plain", photo.id);
          event.dataTransfer.effectAllowed = "move";
          item.classList.add("dragging");
        });
        // Reorder nodes in place while dragging; replacing the dragged
        // element would cancel the drag. The grid re-renders on dragend.
        item.addEventListener("dragover", (event) => {
          if (!dragged) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          if (dragged === photo.id) return;
          const from = position(dragged);
          const to = position(photo.id);
          entries.splice(to, 0, entries.splice(from, 1)[0]);
          const node = tile(dragged)!;
          item.parentNode!.insertBefore(
            node,
            from < to ? item.nextSibling : item,
          );
        });
        item.addEventListener("drop", (event) => {
          if (!dragged) return;
          event.preventDefault();
          event.stopPropagation();
        });
        return item;
      }),
    );
    list.hidden = !entries.length;
  }
  list.addEventListener("dragend", () => {
    if (!dragged) return;
    const id = dragged;
    const start = Number(list.dataset.dragStart);
    dragged = undefined;
    render();
    tile(id)?.focus();
    const to = position(id);
    if (to !== start) {
      options.announce(
        `Photo moved to position ${to + 1} of ${entries.length}.`,
      );
      options.changed();
    }
  });
  render();
  return {
    snapshot: () => entries.map((photo) => ({ ...photo })),
    photos: () => entries.map((photo) => ({ ...photo })),
    count: () => entries.length,
    // True while a reorder drag is in progress, so file drops can ignore it.
    dragging: () => !!dragged,
    add(src: string) {
      entries.push(entry({ src }));
      render();
      options.changed();
    },
    swap(from: string, to: string) {
      if (from.startsWith("blob:")) shown.set(to, from);
      for (const photo of entries) if (photo.src === from) photo.src = to;
      render();
    },
    saved(photos: Photo[]) {
      entries = photos.map(entry);
      render();
    },
    validate(published: boolean) {
      if (published && !entries.length) {
        root.querySelector<HTMLElement>("[data-pick-upload]")?.focus();
        return "Add a photo before publishing.";
      }
      return "";
    },
  };
}
