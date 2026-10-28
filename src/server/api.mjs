import { InputError } from "./store.mjs";
import { collectionState } from "./changes.mjs";
async function read(request, limit) {
  if (Number(request.headers["content-length"]) > limit)
    throw new InputError("Request is too large.", 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new InputError("Request is too large.", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createApi(store, token) {
  return async (request, response, route, url) => {
    const send = (status, payload) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(payload));
    };
    try {
      const method = request.method;
      if (method === "GET" && route === "/session")
        return send(200, { token, limits: store.limits });
      if (method === "GET" && route === "/changes")
        return send(200, collectionState(await store.list()));
      if (method === "GET" && route === "/trash")
        return send(200, await store.listTrash());
      const match = /^\/posts\/([a-zA-Z0-9_-]+)$/.exec(route);
      const trashed = /^\/trash\/([a-zA-Z0-9_-]+)(\/restore)?$/.exec(route);
      if (method === "GET" && match)
        return send(200, await store.get(match[1]));
      if (!["POST", "PUT", "DELETE"].includes(method))
        throw new InputError("Method not allowed.", 405);
      if (request.headers["x-microbloggr-token"] !== token)
        throw new InputError(
          "Editor session expired. Reload after copying any unsaved changes.",
          403,
        );
      if (method === "POST" && route === "/uploads") {
        const type = url.searchParams.get("type");
        if (!Object.hasOwn(store.limits, type))
          throw new InputError("Choose a media type.");
        return send(
          201,
          await store.upload(type, await read(request, store.limits[type])),
        );
      }
      if (!request.headers["content-type"]?.startsWith("application/json"))
        throw new InputError("Expected JSON.", 415);
      let data;
      try {
        data = JSON.parse((await read(request, 2 * 1024 ** 2)).toString());
      } catch (e) {
        if (e instanceof InputError) throw e;
        throw new InputError("Invalid JSON.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new InputError("Invalid payload.");
      if (method === "POST" && trashed?.[2])
        return send(200, await store.restore(trashed[1]));
      if (method === "DELETE" && trashed && !trashed[2])
        return send(200, await store.purge(trashed[1]));
      if (method === "DELETE" && route === "/trash")
        return send(200, await store.emptyTrash());
      if (method === "POST" && route === "/imports")
        return send(201, await store.importUrl(data.type, data.url));
      if (method === "POST" && route === "/posts")
        return send(201, await store.save(data));
      if (method === "PUT" && match)
        return send(200, await store.save(data, match[1]));
      if (method === "DELETE" && match)
        return send(200, await store.remove(match[1], data.revision));
      throw new InputError("Endpoint not found.", 404);
    } catch (error) {
      if (!(error instanceof InputError)) console.error("[microbloggr]", error);
      send(error instanceof InputError ? error.status : 500, {
        error:
          error instanceof InputError
            ? error.message
            : "Could not complete the operation. Your form has been kept. Check the terminal and try again.",
      });
    }
  };
}
