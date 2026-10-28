import { test } from "node:test";
import assert from "node:assert/strict";
import microbloggr from "../src/index.mjs";
import {
  allowLocalRequest,
  normalizeEditorPath,
  isEditorPath,
  withBase,
} from "../src/access.mjs";

function setup(command, editorPath = "/editor", base = "/") {
  const events = { routes: [], toolbar: [], config: [] };
  const integration = microbloggr({ editorPath });
  integration.hooks["astro:config:setup"]({
    command,
    config: { base, root: new URL("./fixtures/site/", import.meta.url) },
    injectRoute: (route) => events.routes.push(route),
    addDevToolbarApp: (app) => events.toolbar.push(app),
    updateConfig: (config) => events.config.push(config),
  });
  return { events, integration };
}

for (const command of ["build", "preview", "sync"]) {
  test(`${command} registers no editor routes, toolbar, plugins, or server middleware`, () => {
    const { events, integration } = setup(command);
    integration.hooks["astro:server:setup"]({
      server: {
        middlewares: { use: () => assert.fail("Registered dev middleware") },
      },
    });
    assert.deepEqual(events, { routes: [], toolbar: [], config: [] });
  });
}

test("dev uses the configured route and base without changing host production settings", () => {
  const { events } = setup("dev", "/tools/write/", "/garden/");
  assert.equal(events.routes[0].pattern, "/tools/write/[...path]");
  assert.equal(events.routes[0].prerender, false);
  assert.equal(events.toolbar[0].name, "Microbloggr");
  const plugin = events.config[0].vite.plugins[0];
  assert.match(
    plugin.load(plugin.resolveId("virtual:microbloggr")),
    /\/garden\/tools\/write/,
  );
  assert.equal(withBase("/", "/editor"), "/editor");
});

test("explicit host routes under the editor prefix produce a clear collision error", () => {
  const { integration } = setup("dev");
  assert.throws(
    () =>
      integration.hooks["astro:routes:resolved"]({
        routes: [
          {
            pattern: "/editor/archive",
            entrypoint: "src/pages/editor/archive.astro",
          },
        ],
      }),
    /conflicts/,
  );
  assert.doesNotThrow(() =>
    integration.hooks["astro:routes:resolved"]({
      routes: [
        { pattern: "/editorial", entrypoint: "src/pages/editorial.astro" },
      ],
    }),
  );
});

test("editor path rejects roots, URLs, traversal, queries, and dynamic segments", () => {
  for (const path of [
    "/",
    "https://example.com",
    "/foo/../bar",
    "/editor?x=1",
    "/[slug]",
    "//editor",
    "/a\\b",
  ])
    assert.throws(() => normalizeEditorPath(path));
  assert.equal(normalizeEditorPath("/tools/write/"), "/tools/write");
  assert.equal(isEditorPath("/editorial", "/editor"), false);
  assert.equal(isEditorPath("/editor/posts/example", "/editor"), true);
});

test("the request guard covers URLs before and after Vite strips the base", () => {
  const { integration } = setup("dev", "/tools/write", "/garden/");
  let middleware;
  integration.hooks["astro:server:setup"]({
    server: {
      middlewares: {
        use: (handler) => {
          middleware = handler;
        },
      },
    },
  });
  for (const url of [
    "/garden/tools/write",
    "/tools/write",
    "/tools/write/archive",
  ]) {
    let status;
    const response = {
      setHeader() {},
      writeHead(code) {
        status = code;
        return this;
      },
      end() {},
    };
    middleware(
      {
        url,
        method: "POST",
        headers: { host: "localhost:4321" },
        socket: { remoteAddress: "127.0.0.1" },
      },
      response,
      () => assert.fail("Editor guard was bypassed"),
    );
    assert.equal(status, 405);
  }
});

test("requests require a loopback socket, local host, same origin, and no forwarded headers", () => {
  const request = (address, headers = {}) => ({
    socket: { remoteAddress: address },
    headers: { host: "localhost:4321", ...headers },
  });
  assert.equal(allowLocalRequest(request("127.0.0.1")), true);
  assert.equal(
    allowLocalRequest(request("::1", { origin: "http://localhost:4321" })),
    true,
  );
  assert.equal(allowLocalRequest(request("::ffff:127.0.0.1")), true);
  for (const address of ["192.168.1.12", "10.0.0.2", undefined])
    assert.equal(allowLocalRequest(request(address)), false);
  for (const headers of [
    { host: "attacker.example" },
    { origin: "https://attacker.example" },
    { origin: "null" },
    { forwarded: "for=127.0.0.1" },
    { "x-forwarded-for": "127.0.0.1" },
    { "sec-fetch-site": "cross-site" },
  ])
    assert.equal(allowLocalRequest(request("127.0.0.1", headers)), false);
});
