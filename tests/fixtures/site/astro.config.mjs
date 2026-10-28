import { defineConfig } from "astro/config";
import microbloggr from "../../../src/index.mjs";

export default defineConfig({
  base: process.env.PLAYGROUND_BASE || "/",
  integrations: [
    microbloggr({
      editorPath: process.env.PLAYGROUND_EDITOR_PATH || "/editor",
      // The integration check runs offline.
      providerLookups: process.env.PLAYGROUND_PROVIDER_LOOKUPS !== "off",
    }),
  ],
});
