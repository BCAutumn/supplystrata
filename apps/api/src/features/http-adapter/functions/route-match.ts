import { API_ROUTES, type ApiPathParams, type ApiRouteContract } from "@supplystrata/api-orchestration";
import type { ApiRouteMatch } from "../definitions/http-adapter.js";

export function matchApiRoute(method: string, url: URL, routes: readonly ApiRouteContract[] = API_ROUTES): ApiRouteMatch | undefined {
  const normalizedMethod = method.toUpperCase();
  for (const route of routes) {
    if (route.method !== normalizedMethod) continue;
    const pathParams = matchPath(route.path, url.pathname);
    if (pathParams === undefined) continue;
    return { route, path_params: pathParams, query: url.searchParams };
  }
  return undefined;
}

function matchPath(routePath: ApiRouteContract["path"], pathname: string): ApiPathParams | undefined {
  const routeSegments = routePath.split("/").filter(Boolean);
  const requestSegments = pathname.split("/").filter(Boolean);
  if (routeSegments.length !== requestSegments.length) return undefined;

  const params: ApiPathParams = {};
  for (const [index, routeSegment] of routeSegments.entries()) {
    const requestSegment = requestSegments[index];
    if (requestSegment === undefined) return undefined;
    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = decodeURIComponent(requestSegment);
      continue;
    }
    if (routeSegment !== requestSegment) return undefined;
  }
  return params;
}
