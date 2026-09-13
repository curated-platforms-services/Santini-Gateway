Apollo Federation gateway, protected subgraph registry, operator dashboard, and PostgreSQL audit trail.

## Safety properties

- Gateway configuration is persisted in PostgreSQL.
- Only enabled subgraphs are loaded during startup.
- Configuration changes are audited.
- URL registration rejects embedded credentials.
- Optional host allowlisting mitigates SSRF through administrator-controlled endpoints.
- Subgraph changes require a rolling restart to become active.
- GraphQL client authentication is optional only for trusted internal deployments.

## Local development

```bash
cp .env.example .env
bun install
docker compose up --build
```

Open:

```text
http://localhost:8088
```

Use the default local administrator token:

```text
local-admin-token
```

The gateway starts unready until at least one enabled Apollo Federation-compatible subgraph exists.

## Registering a subgraph

From the operator dashboard, register a reachable subgraph, validate it, then restart the gateway:

```bash
docker compose restart gateway
```

For production, use a rollout/restart mechanism that waits for `/readyz` before shifting traffic.

## GraphQL request

```bash
curl -sS http://localhost:8088/graphql \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-client-token' \
  --data '{"query":"query { __typename }"}'
```

A useful result requires at least one valid federated subgraph and a successful startup composition.

## Database migration

```bash
bun run db:migrate
```

The migration runner records applied migration filenames in `schema_migrations`.
```

---