import { Pool } from "pg";
import { config } from "./config";
import type { AuditEvent, Subgraph } from "./types";

export const db = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

function subgraphRow(row: Record<string, unknown>): Subgraph {
  return {
    id: String(row.id),
    name: String(row.name),
    url: String(row.url),
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

export async function listSubgraphs(): Promise<Subgraph[]> {
  const result = await db.query(
    `SELECT id, name, url, enabled, created_at, updated_at
     FROM subgraphs
     ORDER BY name ASC`
  );
  return result.rows.map(subgraphRow);
}

export async function enabledSubgraphs(): Promise<Subgraph[]> {
  const result = await db.query(
    `SELECT id, name, url, enabled, created_at, updated_at
     FROM subgraphs
     WHERE enabled = true
     ORDER BY name ASC`
  );
  return result.rows.map(subgraphRow);
}

export async function getSubgraph(id: string): Promise<Subgraph | null> {
  const result = await db.query(
    `SELECT id, name, url, enabled, created_at, updated_at
     FROM subgraphs WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? subgraphRow(result.rows[0]) : null;
}

export async function createSubgraph(
  input: Pick<Subgraph, "name" | "url" | "enabled">
): Promise<Subgraph> {
  const result = await db.query(
    `INSERT INTO subgraphs (name, url, enabled)
     VALUES ($1, $2, $3)
     RETURNING id, name, url, enabled, created_at, updated_at`,
    [input.name, input.url, input.enabled]
  );
  return subgraphRow(result.rows[0]);
}

export async function updateSubgraph(
  id: string,
  input: Partial<Pick<Subgraph, "url" | "enabled">>
): Promise<Subgraph | null> {
  const result = await db.query(
    `UPDATE subgraphs
     SET url = COALESCE($2, url),
         enabled = COALESCE($3, enabled),
         updated_at = now()
     WHERE id = $1
     RETURNING id, name, url, enabled, created_at, updated_at`,
    [id, input.url ?? null, input.enabled ?? null]
  );
  return result.rows[0] ? subgraphRow(result.rows[0]) : null;
}

export async function writeAuditEvent(input: {
  eventType: string;
  actor: string;
  subjectType: string;
  subjectId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO audit_events
      (event_type, actor, subject_type, subject_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.eventType,
      input.actor,
      input.subjectType,
      input.subjectId ?? null,
      JSON.stringify(input.detail ?? {})
    ]
  );
}

export async function listAuditEvents(): Promise<AuditEvent[]> {
  const result = await db.query(
    `SELECT id, event_type, actor, subject_type, subject_id, detail, created_at
     FROM audit_events
     ORDER BY created_at DESC
     LIMIT 100`
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    actor: String(row.actor),
    subjectType: String(row.subject_type),
    subjectId: row.subject_id ? String(row.subject_id) : null,
    detail: row.detail as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString()
  }));
}
