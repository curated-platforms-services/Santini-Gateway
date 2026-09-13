import { config } from "./config";
import { db } from "./db";
import { buildGateway } from "./gateway";
import { log } from "./observability";
import { createFetchHandler } from "./web";

let gateway = null;
let runtime = {
  startedAt: new Date().toISOString(),
  activeSubgraphs: [] as Array<{ name: string; url: string }>,
  ready: false,
  compositionError: "gateway has not initialized"
};

try {
  await db.query("SELECT 1");
  const built = await buildGateway();
  gateway = built.server;
  runtime = built.state;
} catch (cause) {
  runtime = {
    ...runtime,
    compositionError: cause instanceof Error ? cause.message : "gateway startup failed"
  };
  log("error", "gateway_startup_failed", { error: runtime.compositionError });
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: createFetchHandler({ gateway, runtime }),
  error(error) {
    log("error", "uncaught_handler_error", { error: String(error) });
    return Response.json(
      { error: { code: "internal_error", message: "unexpected server error" } },
      { status: 500 }
    );
  }
});

log("info", "http_server_started", {
  host: config.host,
  port: server.port,
  ready: runtime.ready
});

async function shutdown(signal: string) {
  log("info", "shutdown_started", { signal });
  await gateway?.stop();
  await db.end();
  server.stop(true);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
```

### `scripts/migrate.ts`

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/db";

const directory = "./db/migrations";

await db.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const files = (await readdir(directory))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const filename of files) {
  const applied = await db.query(
    "SELECT 1 FROM schema_migrations WHERE filename = $1",
    [filename]
  );
  if (applied.rowCount) continue;

  const sql = await readFile(join(directory, filename), "utf8");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1)",
      [filename]
    );
    await client.query("COMMIT");
    console.log(`applied ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

await db.end();
```

### `static/index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Santini Gateway</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">SANTINI</p>
      <h1>Gateway control plane</h1>
      <p>Federated GraphQL subgraph registry and runtime diagnostics.</p>
    </header>

    <section class="card">
      <h2>Administrator session</h2>
      <label for="token">Administrator bearer token</label>
      <input id="token" type="password" autocomplete="off">
      <button id="save-token" type="button">Use token</button>
      <p class="hint">The token is stored in this browser session only.</p>
    </section>

    <section class="card">
      <h2>Runtime</h2>
      <div id="runtime" aria-live="polite">Loading state unavailable until authenticated.</div>
    </section>

    <section class="card">
      <h2>Register subgraph</h2>
      <form id="subgraph-form">
        <label for="name">Name</label>
        <input id="name" name="name" required pattern="^[a-z][a-z0-9-]{1,63}$" placeholder="accounts">

        <label for="url">Federation URL</label>
        <input id="url" name="url" type="url" required placeholder="http://accounts-subgraph:4001/graphql">

        <label class="checkbox">
          <input id="enabled" name="enabled" type="checkbox" checked>
          Enable this subgraph on the next gateway restart
        </label>

        <button type="submit">Register subgraph</button>
      </form>
    </section>

    <section class="card">
      <div class="row">
        <h2>Registered subgraphs</h2>
        <button id="refresh" type="button">Refresh</button>
      </div>
      <p id="status" role="status">Enter an administrator token to load configuration.</p>
      <div id="subgraphs" aria-live="polite"></div>
    </section>

    <section class="card">
      <h2>Recent audit events</h2>
      <div id="audit" aria-live="polite">No data loaded.</div>
    </section>
  </main>
  <script src="/app.js"></script>
</body>
</html>