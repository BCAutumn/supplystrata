# @supplystrata/api-orchestration

`@supplystrata/api-orchestration` holds the reusable API/MCP orchestration boundary.

It owns the versioned route registry, public DTO contract, read/write operation handler types, database-backed operation handler assembly, and shared read-through report summary logic. `apps/api` keeps the Node HTTP transport and response-envelope wiring; future `apps/mcp` must depend on this package instead of importing from `apps/api`.

Boundary rules:

- Returns public DTOs and operation errors only; no `IncomingMessage`, `ServerResponse`, Express request/response, or header writing belongs here.
- Does not start servers, bind ports, or serialize HTTP responses.
- Does not bypass fact-write invariants. Review and research-run mutations still use the existing domain workflows.
- Can be consumed by multiple surfaces (`apps/api`, future `apps/mcp`) without creating cross-app dependencies.
