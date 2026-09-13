import { config } from "./config";

const subgraphName = /^[a-z][a-z0-9-]{1,63}$/;

export type CreateSubgraphInput = {
  name: string;
  url: string;
  enabled?: boolean;
};

export type UpdateSubgraphInput = {
  url?: string;
  enabled?: boolean;
};

export function validateSubgraphName(value: unknown): string {
  if (typeof value !== "string" || !subgraphName.test(value)) {
    throw new Error("name must match ^[a-z][a-z0-9-]{1,63}$");
  }
  return value;
}

export function validateSubgraphUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("url must be a string");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("url must be a valid absolute URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url protocol must be http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("url must not contain credentials");
  }
  if (
    config.allowedSubgraphHosts.size > 0 &&
    !config.allowedSubgraphHosts.has(parsed.hostname)
  ) {
    throw new Error(`url host ${parsed.hostname} is not allowed`);
  }

  return parsed.toString();
}

export function validateCreateSubgraph(body: unknown): Required<CreateSubgraphInput> {
  if (!body || typeof body !== "object") throw new Error("JSON object required");
  const value = body as Record<string, unknown>;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error("enabled must be boolean");
  }

  return {
    name: validateSubgraphName(value.name),
    url: validateSubgraphUrl(value.url),
    enabled: value.enabled ?? true
  };
}

export function validateUpdateSubgraph(body: unknown): UpdateSubgraphInput {
  if (!body || typeof body !== "object") throw new Error("JSON object required");
  const value = body as Record<string, unknown>;
  if (value.url === undefined && value.enabled === undefined) {
    throw new Error("at least one of url or enabled is required");
  }

  const output: UpdateSubgraphInput = {};
  if (value.url !== undefined) output.url = validateSubgraphUrl(value.url);
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean") throw new Error("enabled must be boolean");
    output.enabled = value.enabled;
  }
  return output;
}