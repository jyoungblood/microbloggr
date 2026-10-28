import { mountPage, wroteRecently } from "./page";
mountPage();
// Astro broadcasts collection writes as wildcard full reloads, and moving or
// removing a post file also sends a reload with no path. Vite's hook runs
// before its path check; scope those reloads away from this editor page.
// The collection poll shows a notice instead. Public pages keep normal HMR,
// and a pathless reload still goes through unless this tab just saved.
if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", (payload) => {
    if (
      payload.path !== "*" &&
      !(payload.path === undefined && wroteRecently())
    )
      return;
    payload.path = `${location.pathname}/__microbloggr_manual_reload__.html`;
    document.dispatchEvent(new Event("microbloggr:check"));
  });
}
document
  .querySelectorAll<HTMLFormElement>("form[data-composer]")
  .forEach((form) => {
    void import("./composer")
      .then(({ mountComposer }) => mountComposer(form))
      .catch((error) => {
        const notice = form
          .closest(".composer")
          ?.querySelector<HTMLElement>(".form-error");
        if (notice) {
          notice.hidden = false;
          notice.textContent = `Could not initialize the editor: ${error.message}`;
        }
      });
  });
