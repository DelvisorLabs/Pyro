#!/usr/bin/env node
import { CommanderError } from "commander";
import { createProgram } from "./cli.js";
import { CliError } from "./transport.js";

// Closed pipes are normal for commands such as `pyro events | head`.
process.stdout.on("error", error => { if ((error as NodeJS.ErrnoException).code === "EPIPE") process.exit(0); else throw error; });
const program = createProgram().exitOverride();
try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError) process.exitCode = error.exitCode === 0 ? 0 : 2;
  else {
    const message = error instanceof Error ? error.message : "Unknown CLI error.";
    const details = error instanceof CliError ? error.details : undefined;
    if (program.opts().json) process.stderr.write(`${JSON.stringify({ error: message, ...details })}\n`);
    else process.stderr.write(`pyro: ${message}${details?.requestId ? ` (request ${details.requestId})` : ""}${details?.retryAfter ? ` Retry after ${details.retryAfter}s.` : ""}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 2;
  }
}
