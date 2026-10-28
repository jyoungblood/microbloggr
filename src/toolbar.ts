import { defineToolbarApp } from "astro/toolbar";
import config from "virtual:microbloggr";

export default defineToolbarApp({
  init(_canvas, app) {
    app.onToggled(({ state }) => {
      if (state) window.location.assign(config.editorUrl);
    });
  },
});
