import { trace } from "@opentelemetry/api";

export const tracer = trace.getTracer("santini-gateway");

export function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {}
): void {
  console.log(
    JSON.stringify({
      level,
      event,
      time: new Date().toISOString(),
      ...fields
    })
  );
}
```

### `src/gateway.ts`

```typescript
import { ApolloGateway, RemoteGraphQLDataSource } from "@apollo/gateway";
import { ApolloServer } from "@apollo/server";
import { config } from "./config";
import { enabledSubgraphs } from "./db";
import { log } from "./observability";
import type { RuntimeState } from "./types";

class SantiniDataSource extends RemoteGraphQLDataSource {
  override willSendRequest({
    request,
    context
  }: {
    request: { http?: { headers: Headers } };
    context: { requestId: string; authorization?: string };
  }) {
    request.http?.headers.set("x-request-id", context.requestId);
    if (context.authorization) {
      request.http?.headers.set("authorization", context.authorization);
    }
  }
}

export async function buildGateway(): Promise<{
  server: ApolloServer;
  state: RuntimeState;
}> {
  const subgraphs = await enabledSubgraphs();

  if (subgraphs.length === 0) {
    throw new Error("no enabled subgraphs registered");
  }

  const gateway = new ApolloGateway({
    serviceList: subgraphs.map((subgraph) => ({
      name: subgraph.name,
      url: subgraph.url
    })),
    buildService({ url }) {
      return new SantiniDataSource({
        url,
        fetcher: async (input, init) => {
          const signal = AbortSignal.timeout(config.subgraphTimeoutMs);
          return fetch(input, { ...init, signal });
        }
      });
    }
  });

  const server = new ApolloServer({
    gateway,
    introspection: false,
    includeStacktraceInErrorResponses: false
  });

  await server.start();

  const state: RuntimeState = {
    startedAt: new Date().toISOString(),
    activeSubgraphs: subgraphs.map(({ name, url }) => ({ name, url })),
    ready: true,
    compositionError: null
  };

  log("info", "gateway_started", {
    subgraphCount: state.activeSubgraphs.length,
    subgraphs: state.activeSubgraphs.map((item) => item.name)
  });

  return { server, state };
}
```

### `src/web.ts`

```typescript
import type { ApolloServer } from "@apollo/server";
import { config } from "./config";
import {
  createSubgraph,
  db,
  getSubgraph,
  listAuditEvents,
  listSubgraphs,
  updateSubgraph,
  writeAuditEvent
} from "./db";
import { log } from "./observability";
import type { RuntimeState } from "./types";
import { validateCreateSubgraph, validateUpdateSubgraph } from "./validation";

type AppState = {
  gateway: ApolloServer | null;
  runtime: RuntimeState;
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function error(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function adminAuthorized(request: Request): boolean {
  return request.headers.get("authorization") === `Bearer ${config.adminToken}`;
}

function clientAuthorized(request: Request): boolean {
  return !config.clientToken ||
    request.headers.get("authorization") === `Bearer ${config.clientToken}`;
}

async function requestJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 1_048_576) throw new Error("request body exceeds 1 MiB");
  return request.json();
}

async function validateSubgraphEndpoint(url: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(config.healthTimeoutMs),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "query SantiniGatewayHealthCheck { __typename }" })
  });

  if (!response.ok) {
    throw new Error(`subgraph returned HTTP ${response.status}`);
  }

  const body = await response.json() as { errors?: unknown[] };
  if (body.errors?.length) throw new Error("subgraph returned GraphQL errors");
}

export function createFetchHandler(state: AppState) {
  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = requestId(request);

    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        await db.query("SELECT 1");
        return json(200, { status: "ok" });
      }

      if (request.method === "GET" && url.pathname === "/readyz") {
        return state.runtime.ready
          ? json(200, { status: "ready", activeSubgraphs: state.runtime.activeSubgraphs })
          : error(503, "gateway_unavailable", state.runtime.compositionError ?? "gateway unavailable");
      }

      if (url.pathname === "/graphql") {
        if (!clientAuthorized(request)) {
          return error(401, "unauthorized", "valid client bearer token required");
        }
        if (!state.gateway || !state.runtime.ready) {
          return error(503, "gateway_unavailable", "gateway composition is not ready");
        }

        return state.gateway.executeHTTPGraphQLRequest({
          httpGraphQLRequest: {
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            search: url.search,
            body: request.method === "GET" ? undefined : await request.text()
          },
          context: async () => ({
            requestId: id,
            authorization: request.headers.get("authorization") ?? undefined
          })
        }).then((result) => new Response(
          result.body.kind === "complete" ? result.body.string : null,
          { status: result.status ?? 200, headers: result.headers }
        ));
      }

      if (!url.pathname.startsWith("/api/admin/")) {
        if (request.method === "GET" && url.pathname === "/") {
          return new Response(Bun.file("./static/index.html"), {
            headers: { "content-type": "text/html; charset=utf-8" }
          });
        }
        if (request.method === "GET" && ["/app.js", "/styles.css"].includes(url.pathname)) {
          const contentType = url.pathname.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8";
          return new Response(Bun.file(`./static${url.pathname}`), {
            headers: { "content-type": contentType }
          });
        }
        return error(404, "not_found", "route not found");
      }

      if (!adminAuthorized(request)) {
        return error(401, "unauthorized", "valid administrator bearer token required");
      }

      if (request.method === "GET" && url.pathname === "/api/admin/subgraphs") {
        return json(200, { subgraphs: await listSubgraphs() });
      }

      if (request.method === "POST" && url.pathname === "/api/admin/subgraphs") {
        const input = validateCreateSubgraph(await requestJson(request));
        const subgraph = await createSubgraph(input);
        await writeAuditEvent({
          eventType: "subgraph.created",
          actor: "admin-token",
          subjectType: "subgraph",
          subjectId: subgraph.id,
          detail: { name: subgraph.name, enabled: subgraph.enabled }
        });
        return json(201, { subgraph, reloadRequired: true });
      }

      const match = url.pathname.match(/^\/api\/admin\/subgraphs\/([0-9a-f-]{36})(?:\/(validate))?$/i);
      if (match) {
        const [, subgraphId, action] = match;
        const subgraph = await getSubgraph(subgraphId);
        if (!subgraph) return error(404, "not_found", "subgraph not found");

        if (request.method === "POST" && action === "validate") {
          await validateSubgraphEndpoint(subgraph.url);
          await writeAuditEvent({
            eventType: "subgraph.validated",
            actor: "admin-token",
            subjectType: "subgraph",
            subjectId: subgraph.id,
            detail: { url: subgraph.url }
          });
          return json(200, { valid: true, subgraphId: subgraph.id });
        }

        if (request.method === "PATCH" && !action) {
          const input = validateUpdateSubgraph(await requestJson(request));
          const updated = await updateSubgraph(subgraphId, input);
          if (!updated) return error(404, "not_found", "subgraph not found");
          await writeAuditEvent({
            eventType: "subgraph.updated",
            actor: "admin-token",
            subjectType: "subgraph",
            subjectId: updated.id,
            detail: input
          });
          return json(200, { subgraph: updated, reloadRequired: true });
        }
      }

      if (request.method === "GET" && url.pathname === "/api/admin/audit-events") {
        return json(200, { events: await listAuditEvents() });
      }

      if (request.method === "GET" && url.pathname === "/api/admin/runtime") {
        return json(200, {
          runtime: state.runtime,
          reloadRequired: true,
          note: "Configuration changes are durable but require a rolling restart before Apollo Gateway recomposes."
        });
      }

      return error(404, "not_found", "route not found");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "unexpected error";
      log("error", "request_failed", { requestId: id, path: url.pathname, message });

      if (
        message.includes("must") ||
        message.includes("required") ||
        message.includes("valid") ||
        message.includes("allowed") ||
        message.includes("JSON") ||
        message.includes("MiB")
      ) {
        return error(400, "validation_error", message);
      }
      if (message.includes("duplicate key")) {
        return error(409, "conflict", "subgraph name already exists");
      }
      if (message.includes("subgraph returned") || message.includes("fetch failed")) {
        return error(503, "dependency_unavailable", message);
      }
      return error(500, "internal_error", "request failed");
    }
  };
}
