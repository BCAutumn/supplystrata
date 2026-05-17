#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const rootDir = process.cwd();
const port = readPort();
const host = "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (requestUrl.pathname === "/") {
      response.writeHead(302, {
        Location: "/apps/research-preview/index.html"
      });
      response.end();
      return;
    }

    const filePath = resolveSafePath(decodeURIComponent(requestUrl.pathname));
    if (filePath === null || !existsSync(filePath)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const stat = statSync(filePath);
    if (!stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypeForPath(filePath),
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(message);
  }
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/apps/research-preview/index.html`;
  console.log(`SupplyStrata research preview is serving ${rootDir}`);
  console.log(`Open ${url}`);
  console.log(`With report: ${url}?report=/reports/nvidia-workbench.json`);
});

function readPort() {
  const flagPort = valueAfterFlag("--port");
  const rawPort = flagPort ?? process.env.PORT ?? "4173";
  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  return parsed;
}

function valueAfterFlag(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex < 0) return undefined;
  return process.argv[flagIndex + 1];
}

function resolveSafePath(pathname) {
  // 仅服务当前仓库内的文件，避免本地静态服务被路径穿越利用。
  const resolved = normalize(join(rootDir, pathname));
  if (resolved !== rootDir && !resolved.startsWith(`${rootDir}${sep}`)) return null;
  return resolved;
}

function mimeTypeForPath(filePath) {
  return mimeTypes[extname(filePath)] ?? "application/octet-stream";
}
