import { readFileSync } from "node:fs";
import { open, readFile, rm, type FileHandle } from "node:fs/promises";
import { Command } from "commander";
import { configPath, normalizeUrl, readConfig, settings, writeConfig, type GlobalOptions } from "./config.js";
import { jsonSource, parseValue, passwordPrompt, readStdin, source } from "./input.js";
import { bodyProperties, endpoints, kebab, optionKey, specs, type Endpoint } from "./spec.js";
import { CliError, credentials, request, stream } from "./transport.js";
import { diagnose } from "./doctor.js";

type Options = Record<string, string | boolean | undefined>;

async function output(data: unknown, options: GlobalOptions & { outputFile?: FileHandle }, raw = false) {
  if (data === undefined) return;
  const value = raw ? String(data) : JSON.stringify(data, null, options.json ? undefined : 2);
  if (options.outputFile) {
    await options.outputFile.writeFile(value);
  } else process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function dataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Body field flags require a JSON object.");
  return value as Record<string, unknown>;
}

async function buildBody(endpoint: Endpoint, options: Options, args: string[]): Promise<{ body?: string; contentType?: string }> {
  if (!endpoint.requestBody) return {};
  const kind = endpoint["x-cli-input"];
  const contentType = String(options.contentType ?? "application/json");
  if (!endpoint.requestBody.content[contentType]) throw new Error(`Unsupported content type: ${contentType}.`);
  const properties = bodyProperties(endpoint);
  const suppliedFields = Object.entries(properties).filter(([name]) => options[optionKey(name)] !== undefined);
  if (options.data !== undefined && (suppliedFields.length || options.file || args.length || options.passwordStdin)) {
    throw new Error("Use either --data for an exact request body or the convenience input/field flags.");
  }
  if (options.data !== undefined) {
    return { body: contentType === "application/json" ? JSON.stringify(await jsonSource(String(options.data))) : await source(String(options.data)), contentType };
  }
  if (kind === "login") {
    const password = options.passwordStdin ? (await readStdin()).replace(/\r?\n$/, "") : await passwordPrompt();
    return { body: JSON.stringify({ password, ...(options.username ? { username: options.username } : {}) }), contentType };
  }
  if (contentType !== "application/json") throw new Error("Use --data with this content type; for a text file use --data @input.txt.");
  let body: Record<string, unknown> = {};
  for (const [name, schema] of suppliedFields) body[name] = await parseValue(String(options[optionKey(name)]), schema, `--${kebab(name)}`);
  if (kind === "classification") {
    const sources = Number(args[0] !== undefined) + Number(options.file !== undefined) + Number(options.input !== undefined);
    if (sources > 1) throw new Error("Choose one input: text argument, --file, or --input.");
    if (args[0] !== undefined) body.input = args[0];
    else if (options.file) body.input = options.file === "-" ? await readStdin() : await readFile(String(options.file), "utf8");
    else if (!sources) body.input = await readStdin();
  }
  if (kind === "profile-yaml" && options.file) {
    if (body.yaml !== undefined) throw new Error("Choose --file or --yaml.");
    body.yaml = options.file === "-" ? await readStdin() : await readFile(String(options.file), "utf8");
  }
  const schema = endpoint.requestBody.content[contentType]!.schema;
  const required = schema.$ref ? endpoint.spec.components.schemas[schema.$ref.split("/").at(-1)!]?.required : schema.required;
  for (const name of required ?? []) if (!(name in body)) throw new Error(`Missing --${kebab(name)}. You can also supply the full request with --data @file.json.`);
  return { body: JSON.stringify(dataObject(body)), contentType };
}

async function runEndpoint(endpoint: Endpoint, command: Command, args: string[]) {
  const options = command.opts<Options>();
  const global = command.optsWithGlobals<GlobalOptions>();
  const path = configPath(global);
  const config = await readConfig(path);
  const resolved = settings(global, config);
  const baseUrl = resolved[endpoint.service];
  const headers = credentials(endpoint, baseUrl, config);
  let route = endpoint.path;
  let position = 0;
  for (const parameter of endpoint.parameters ?? []) if (parameter.in === "path") {
    const value = args[position++]!;
    // WHATWG URL normalizes literal and percent-encoded dot segments.
    if (!value || value === "." || value === "..") throw new Error(`Invalid ${parameter.name}.`);
    route = route.replace(`{${parameter.name}}`, encodeURIComponent(value));
  }
  const url = new URL(`${baseUrl}${route}`);
  for (const parameter of endpoint.parameters ?? []) {
    if (parameter.in === "path") continue;
    const value = options[optionKey(parameter.name)];
    if (value === undefined) {
      if (parameter.required) throw new Error(`Missing --${kebab(parameter.name)}.`);
      continue;
    }
    const parsed = await parseValue(String(value), parameter.schema, `--${kebab(parameter.name)}`);
    if (parameter.in === "query") url.searchParams.set(parameter.name, String(parsed));
    else headers[parameter.name] = String(parsed);
  }
  if (endpoint["x-websocket"]) {
    const count = options.count === undefined ? undefined : Number(options.count);
    if (count !== undefined && (!Number.isInteger(count) || count < 1)) throw new Error("--count must be a positive integer.");
    return stream(url, endpoint, headers, resolved.timeout, count);
  }
  const { body, contentType } = await buildBody(endpoint, options, args.slice(position));
  if (contentType) headers["Content-Type"] = contentType;
  // Reserve the file before any mutation: a bad destination must not lose a one-time key.
  const outputPath = options.output as string | undefined;
  const outputFile = outputPath ? await open(outputPath, "wx", 0o600) : undefined;
  let complete = false;
  try {
    let result;
    try { result = await request(url, endpoint.method, headers, body, resolved.timeout); }
    catch (error) {
      if (endpoint["x-cli-input"] === "logout" && error instanceof CliError && error.details?.status === 401) {
        delete config.sessions?.[baseUrl];
        await writeConfig(path, config);
      }
      throw error;
    }
    if (endpoint["x-cli-input"] === "login") {
      const cookie = result.response.headers.getSetCookie().find(value => value.startsWith("pf_session="));
      const token = cookie?.match(/^pf_session=([^;]+)/)?.[1];
      if (!token) throw new CliError("Login response did not include a session cookie.", 4);
      const maxAge = Number(cookie?.match(/max-age=(\d+)/i)?.[1] ?? 86_400);
      config.sessions = { ...config.sessions, [baseUrl]: { token, expiresAt: Date.now() + maxAge * 1_000 } };
      config.controlUrl = baseUrl;
      await writeConfig(path, config);
    }
    if (endpoint["x-cli-input"] === "logout") {
      delete config.sessions?.[baseUrl];
      await writeConfig(path, config);
    }
    if (result.response.status !== 204) {
      const isJson = result.response.headers.get("content-type")?.includes("json");
      await output(isJson ? result.data : result.text, { ...global, outputFile }, !isJson);
    }
    complete = true;
  } finally {
    await outputFile?.close();
    if (outputFile && !complete) await rm(outputPath!, { force: true });
  }
}

export function createProgram(): Command {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const program = new Command().name("pyro").version(version)
    .description("Pyro — classify inputs and manage a running Pyro server.")
    .option("--gateway-url <url>", "gateway URL (PYRO_GATEWAY_URL; default http://localhost:8080)")
    .option("--control-url <url>", "dashboard API URL (PYRO_CONTROL_URL; default http://localhost:8081)")
    .option("--config <path>", "config file (PYRO_CONFIG or ~/.config/pyro/config.json)")
    .option("--timeout <ms>", "request/authentication timeout (PYRO_TIMEOUT_MS; default 130000)")
    .option("--json", "compact JSON output for scripts (streams always use NDJSON)")
    .showHelpAfterError()
    .addHelpText("after", "\nGet started (a running server is required):\n  pyro doctor                     Check server connectivity and setup\n  pyro auth login                 Sign in with your dashboard password\n  pyro profiles list              Manage the same profiles as the dashboard\n  pyro playground 'hello' --profile local-secrets  After importing the local-only preset\n  PYRO_API_KEY=pf_… pyro classify 'hello'\n\nObserve: overview, usage, activity, playground\nConfigure: profiles, apps, keys, webhooks, settings\nUse `pyro <command> --help` for field flags and examples. No service is started automatically.");
  const groups = new Map<string, Command>([["", program]]);
  program.command("doctor").description("Check server connectivity and semantic configuration without sending prompts")
    .option("--semantic", "also require semantic classifier configuration")
    .action(async (options: { semantic?: boolean }, command: Command) => {
      const global = command.optsWithGlobals<GlobalOptions>();
      const report = await diagnose(settings(global, await readConfig(configPath(global))));
      await output(report, global);
      if (!report.localRulesReady) process.exitCode = 4;
      else if (options.semantic && !report.semantic.ok) process.exitCode = 1;
    });
  const descriptions: Record<string, string> = {
    auth: "Dashboard authentication", profiles: "Profiles and the curated profile library",
    apps: "Applications and local rules", keys: "Application API keys", webhooks: "Webhooks and delivery history",
    settings: "Server settings", "settings provider": "Provider configuration", activity: "Decision traces and live activity",
    gateway: "Public gateway discovery", control: "Control-plane health", jobs: "Background classification jobs",
  };
  const occupied = new Set<string>();
  for (const endpoint of endpoints()) {
    const name = endpoint["x-cli-command"];
    if (!name || occupied.has(name)) throw new Error(`Missing or duplicate CLI command for ${endpoint.operationId}.`);
    occupied.add(name);
    const parts = name.split(" ");
    let parent = program;
    for (let index = 0; index < parts.length - 1; index++) {
      const group = parts.slice(0, index + 1).join(" ");
      if (!groups.has(group)) groups.set(group, parent.command(parts[index]!).description(descriptions[group] ?? group));
      parent = groups.get(group)!;
    }
    const command = parent.command(parts.at(-1)!).description(endpoint.summary);
    const pathArgs = (endpoint.parameters ?? []).filter(parameter => parameter.in === "path");
    for (const parameter of pathArgs) command.argument(`<${parameter.name}>`, parameter.schema.description ?? parameter.name);
    for (const parameter of endpoint.parameters ?? []) if (parameter.in !== "path") {
      command.option(`--${kebab(parameter.name)} <value>`, parameter.schema.description ?? `${parameter.in} parameter: ${parameter.name}${parameter.schema.enum ? ` (${parameter.schema.enum.join(" | ")})` : ""}`);
    }
    const kind = endpoint["x-cli-input"];
    if (endpoint.requestBody) {
      command.option("--data <json|@file|->", "exact request body; @file reads a file, - reads stdin");
      if (Object.keys(endpoint.requestBody.content).length > 1) command.option("--content-type <type>", `body media type (${Object.keys(endpoint.requestBody.content).join(" | ")})`);
      if (kind === "login") command.option("--password-stdin", "read the password from stdin; otherwise prompt without echo");
      else for (const [field, schema] of Object.entries(bodyProperties(endpoint))) {
        const hint = schema.type === "array" || schema.type === "object" || !schema.type ? "JSON or @file" : schema.type === "boolean" ? "true | false" : schema.enum?.join(" | ") ?? schema.type;
        command.option(`--${kebab(field)} <value>`, `${schema.description ?? field} (${hint})`);
      }
    }
    if (kind === "classification") command.argument("[text]", "text input; omit to read stdin").option("--file <path|->", "read text input from a file or stdin; use --input for structured JSON");
    if (kind === "profile-yaml") command.option("--file <path|->", "read a portable profile YAML file or stdin");
    if (endpoint["x-websocket"]) command.option("--count <number>", "stop after this many events; otherwise stream until Ctrl-C");
    else command.option("-o, --output <path>", "write the response to a new file (never overwrite)");
    command.addHelpText("after", `\nAPI: ${endpoint.service} ${endpoint.method} ${endpoint.path}\nOperation: ${endpoint.operationId}${endpoint.description ? `\n${endpoint.description}` : ""}`);
    command.action(async (...values: unknown[]) => {
      const args = values.slice(0, pathArgs.length + (kind === "classification" ? 1 : 0)).filter(value => value !== undefined) as string[];
      await runEndpoint(endpoint, command, args);
    });
  }
  const config = program.command("config").description("Local CLI connection settings");
  config.command("show").description("Show effective connection settings; never show session tokens").action(async (_options, command: Command) => {
    const global = command.optsWithGlobals<GlobalOptions>();
    const path = configPath(global);
    const stored = await readConfig(path);
    const resolved = settings(global, stored);
    await output({ config: path, ...resolved, apiKeyConfigured: Boolean(process.env.PYRO_API_KEY), signedIn: (stored.sessions?.[resolved.control]?.expiresAt ?? 0) > Date.now() }, global);
  });
  config.command("set").description("Save a connection setting").argument("<key>", "gateway-url, control-url, or timeout").argument("<value>")
    .action(async (key: string, value: string, _options, command: Command) => {
      const global = command.optsWithGlobals<GlobalOptions>();
      const path = configPath(global);
      const stored = await readConfig(path);
      if (key === "gateway-url") stored.gatewayUrl = normalizeUrl(value);
      else if (key === "control-url") stored.controlUrl = normalizeUrl(value);
      else if (key === "timeout") { settings({ timeout: value }, stored); stored.timeout = Number(value); }
      else throw new Error("Unknown setting. Choose gateway-url, control-url, or timeout.");
      await writeConfig(path, stored);
      await output({ [key]: value }, global);
    });
  program.command("spec").description("Print the bundled OpenAPI contract").argument("<service>", "gateway or control").action(async (service: string, _options, command: Command) => {
    if (service !== "gateway" && service !== "control") throw new Error("Choose gateway or control.");
    await output(specs[service], command.optsWithGlobals<GlobalOptions>());
  });
  return program;
}
