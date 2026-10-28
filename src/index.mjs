import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createStore } from "./server/store.mjs";
import { createApi } from "./server/api.mjs";
import {
  allowLocalRequest,
  isEditorPath,
  normalizeEditorPath,
  withBase,
} from "./access.mjs";

/** @param {import("./index.d.ts").MicrobloggrOptions} [options] @returns {import('astro').AstroIntegration} */
export default function microbloggr(options = {}) {
  const editorPath = normalizeEditorPath(options.editorPath);
  const entrypoint = fileURLToPath(
    new URL("./pages/Editor.astro", import.meta.url),
  );
  let enabled = false;
  let editorUrl = editorPath;
  let siteBase = "/";
  let projectRoot;
  let storeOptions;
  let api;
  return {
    name: "microbloggr",
    hooks: {
      "astro:config:setup": ({
        command,
        config,
        injectRoute,
        addDevToolbarApp,
        updateConfig,
      }) => {
        enabled = command === "dev";
        if (!enabled) return;
        projectRoot = fileURLToPath(config.root);
        storeOptions = {
          root: projectRoot,
          publicDir: config.publicDir
            ? fileURLToPath(config.publicDir)
            : resolve(projectRoot, "public"),
          contentDir: options.contentDir,
          mediaDir: options.mediaDir,
          uploadLimits: options.uploadLimits,
          providerLookups: options.providerLookups ?? true,
        };
        api = createApi(
          createStore(storeOptions),
          randomBytes(32).toString("hex"),
        );
        siteBase = config.base;
        editorUrl = withBase(siteBase, editorPath);
        injectRoute({
          pattern: `${editorPath}/[...path]`,
          entrypoint,
          prerender: false,
        });
        addDevToolbarApp({
          id: "microbloggr",
          name: "Microbloggr",
          icon: "grid",
          entrypoint: new URL("./toolbar.ts", import.meta.url),
        });
        updateConfig({
          vite: {
            plugins: [
              {
                name: "microbloggr:dev-config",
                resolveId(id) {
                  if (
                    [
                      "virtual:microbloggr",
                      "virtual:microbloggr/server",
                    ].includes(id)
                  )
                    return `\0${id}`;
                },
                load(id) {
                  if (id === "\0virtual:microbloggr/server")
                    return `import { createStore } from ${JSON.stringify(fileURLToPath(new URL("./server/store.mjs", import.meta.url)))}; export default createStore(${JSON.stringify(storeOptions)});`;
                  if (id === "\0virtual:microbloggr")
                    return `export default ${JSON.stringify({ editorUrl, siteBase, thumbnailPath: `/${options.mediaDir ?? "assets/microblog"}/thumbnails/`, clientUrl: withBase(siteBase, `/@fs${fileURLToPath(new URL("./client/entry.ts", import.meta.url))}`) })}`;
                },
              },
            ],
          },
        });
      },
      "astro:routes:resolved": ({ routes }) => {
        if (!enabled) return;
        const collision = routes.find(
          (route) =>
            resolve(projectRoot, route.entrypoint) !== entrypoint &&
            isEditorPath(route.pattern, editorPath),
        );
        if (collision)
          throw new Error(
            `microbloggr: ${collision.pattern} conflicts with editorPath. Choose another editorPath.`,
          );
      },
      "astro:server:setup": ({ server }) => {
        if (!enabled) return;
        server.config?.server?.fs?.allow?.push(
          fileURLToPath(new URL(".", import.meta.url)),
        );
        server.middlewares.use((request, response, next) => {
          let pathname;
          try {
            pathname = decodeURIComponent(
              new URL(request.url || "/", "http://localhost").pathname,
            );
          } catch {
            response.writeHead(400).end("Invalid URL");
            return;
          }
          // Vite can strip the Astro base before handing the URL to this middleware.
          if (
            !isEditorPath(pathname, editorUrl) &&
            !isEditorPath(pathname, editorPath)
          )
            return next();
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("X-Robots-Tag", "noindex, nofollow");
          response.setHeader("X-Frame-Options", "DENY");
          if (!allowLocalRequest(request)) {
            response
              .writeHead(403)
              .end("Microbloggr is available only from this computer.");
            return;
          }
          const prefix = isEditorPath(pathname, editorUrl)
            ? editorUrl
            : editorPath;
          const route = pathname.slice(prefix.length);
          if (route.startsWith("/api/")) {
            void api(
              request,
              response,
              route.slice(4),
              new URL(request.url, "http://localhost"),
            );
            return;
          }
          if (!["GET", "HEAD"].includes(request.method || "")) {
            response.setHeader("Allow", "GET, HEAD");
            response.writeHead(405).end("Use the editor API for writes.");
            return;
          }
          next();
        });
      },
    },
  };
}
