import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import handler from "../.vercel/output/functions/__server.func/index.mjs";

const staticRoot = normalize(join(import.meta.dirname, "../.vercel/output/static"));
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4173");
  const staticPath = normalize(join(staticRoot, decodeURIComponent(url.pathname)));
  if (
    staticPath.startsWith(staticRoot) &&
    existsSync(staticPath) &&
    statSync(staticPath).isFile()
  ) {
    response.setHeader(
      "content-type",
      mimeTypes[extname(staticPath)] ?? "application/octet-stream",
    );
    createReadStream(staticPath).pipe(response);
    return;
  }

  const result = await handler.fetch(
    new Request(url, { method: request.method, headers: request.headers }),
  );
  response.statusCode = result.status;
  for (const [key, value] of result.headers) response.setHeader(key, value);
  response.end(Buffer.from(await result.arrayBuffer()));
}).listen(4173, "127.0.0.1", () => {
  console.log("Preview disponível em http://127.0.0.1:4173");
});
