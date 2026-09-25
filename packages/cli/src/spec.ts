import { readFileSync } from "node:fs";

export type Schema = {
  $ref?: string; type?: string | string[]; description?: string; enum?: unknown[];
  properties?: Record<string, Schema>; required?: string[]; items?: Schema;
  minimum?: number; maximum?: number;
};
export type Parameter = { name: string; in: "path" | "query" | "header"; required?: boolean; schema: Schema };
export type Operation = {
  operationId: string; summary: string; description?: string; "x-cli-command": string;
  "x-cli-input"?: "classification" | "profile-yaml" | "login" | "logout";
  "x-websocket"?: boolean; security?: unknown[]; parameters?: Parameter[];
  requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
};
export type Spec = {
  security: unknown[]; paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};
export type Service = "gateway" | "control";
export type Endpoint = Operation & { service: Service; path: string; method: string; spec: Spec };
export const specs = JSON.parse(readFileSync(new URL("./specs.json", import.meta.url), "utf8")) as Record<Service, Spec>;

export function endpoints(): Endpoint[] {
  return Object.entries(specs).flatMap(([service, spec]) => Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).filter(([method]) => /^(get|post|put|patch|delete|head|options)$/.test(method))
      .map(([method, operation]) => ({ ...operation, service: service as Service, spec, path, method: method.toUpperCase() })),
  ));
}

export function resolveSchema(schema: Schema, spec: Spec): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  const resolved = spec.components.schemas[name];
  if (!resolved) throw new Error(`Unknown schema reference: ${schema.$ref}`);
  return resolved;
}

export function bodyProperties(endpoint: Endpoint): Record<string, Schema> {
  const schema = endpoint.requestBody?.content["application/json"]?.schema;
  if (!schema) return {};
  // Classification accepts an envelope as well as raw JSON. The convenience flags build an envelope.
  if (endpoint["x-cli-input"] === "classification") return endpoint.spec.components.schemas.Envelope?.properties ?? {};
  return resolveSchema(schema, endpoint.spec).properties ?? {};
}

export const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
export const optionKey = (name: string): string => kebab(name).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
