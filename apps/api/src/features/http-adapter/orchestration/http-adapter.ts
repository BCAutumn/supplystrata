import { isEntityResolutionError } from "@supplystrata/db/read";
import { ApiHttpError, type ApiHttpAdapterOptions, type ApiHttpRequest, type ApiHttpResponse, type ApiOperationHandlers } from "../definitions/http-adapter.js";
import { errorHttpResponse, openApiHttpResponse, routeDataHttpResponse } from "../functions/http-response.js";
import { matchApiRoute } from "../functions/route-match.js";

const SUPPORTED_METHODS = new Set(["GET", "POST"]);

export async function handleApiHttpRequest(
  request: ApiHttpRequest,
  handlers: ApiOperationHandlers,
  options: ApiHttpAdapterOptions = {}
): Promise<ApiHttpResponse> {
  const method = request.method.toUpperCase();
  if (!SUPPORTED_METHODS.has(method)) return errorHttpResponse(405, `Unsupported method: ${request.method}`);

  const url = new URL(request.url, "http://localhost");
  if (method === "GET" && url.pathname === "/openapi.json") return openApiHttpResponse();

  const match = matchApiRoute(method, url);
  if (match === undefined) return errorHttpResponse(404, `No API route matches ${method} ${url.pathname}`);

  const handler = handlers[match.route.operation_id];
  if (handler === undefined) return errorHttpResponse(501, `API route is not implemented by this HTTP adapter: ${match.route.operation_id}`);

  const now = options.now?.() ?? new Date().toISOString();
  try {
    const data = await handler({
      route: match.route,
      path_params: match.path_params,
      query: match.query,
      body: request.body,
      now
    });
    return routeDataHttpResponse(match.route, data, now);
  } catch (error) {
    if (error instanceof ApiHttpError) return errorHttpResponse(error.status, error.message);
    if (isEntityResolutionError(error))
      return errorHttpResponse(404, `${error.message}. Run a research bootstrap/sync for this listed company before reading evidence-backed artifacts.`);
    if (error instanceof Error) return errorHttpResponse(500, error.message);
    return errorHttpResponse(500, "Unknown API adapter error");
  }
}
