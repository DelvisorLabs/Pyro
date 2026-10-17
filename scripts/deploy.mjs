#!/usr/bin/env node
// Environment-specific server details and secrets stay in the local deploy directory.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [environment, ...args] = process.argv.slice(2);
if (!["staging", "prod"].includes(environment)) {
  console.error("Usage: pnpm deploy:staging [--check|--build-only|--backup-only] or pnpm deploy:prod [--check|--build-only|--backup-only]");
  process.exitCode = 2;
} else {
  const helper = new URL("../deploy/cloud/update.mjs", import.meta.url);
  if (!existsSync(fileURLToPath(helper))) {
    console.error("Local deployment configuration is missing. Restore your private deploy/cloud files and environment files before deploying.");
    process.exitCode = 1;
  } else {
    try {
      const { deploy } = await import(helper.href);
      await deploy(environment, args);
    } catch (error) {
      console.error(`Deployment stopped: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
