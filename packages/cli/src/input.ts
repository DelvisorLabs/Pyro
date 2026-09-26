import { readFile } from "node:fs/promises";
import type { Schema } from "./spec.js";

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("Pipe input to stdin, or supply a file or value.");
  let value = "";
  for await (const chunk of process.stdin) value += chunk.toString();
  return value;
}

export async function source(value: string): Promise<string> {
  if (value === "-") return readStdin();
  if (value.startsWith("@")) return readFile(value.slice(1), "utf8");
  return value;
}

export async function jsonSource(value: string): Promise<unknown> {
  const text = await source(value);
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON input. Use a JSON value, @file.json, or - for stdin."); }
}

export async function parseValue(value: string, schema: Schema, flag: string): Promise<unknown> {
  let parsed: unknown = value;
  if (schema.type === "boolean") {
    if (value !== "true" && value !== "false") throw new Error(`${flag} must be true or false.`);
    parsed = value === "true";
  } else if (schema.type === "number" || schema.type === "integer") {
    parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || (schema.type === "integer" && !Number.isInteger(parsed))) throw new Error(`${flag} must be ${schema.type === "integer" ? "an integer" : "a number"}.`);
    if (schema.minimum !== undefined && (parsed as number) < schema.minimum || schema.maximum !== undefined && (parsed as number) > schema.maximum) throw new Error(`${flag} is outside the allowed range.`);
  } else if (schema.type === "array" || schema.type === "object" || !schema.type) {
    parsed = await jsonSource(value);
    if (schema.type === "array" && !Array.isArray(parsed)) throw new Error(`${flag} must be a JSON array.`);
    if (schema.type === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) throw new Error(`${flag} must be a JSON object.`);
  }
  if (schema.enum && !schema.enum.includes(parsed)) throw new Error(`${flag} must be one of: ${schema.enum.join(", ")}.`);
  return parsed;
}

export async function passwordPrompt(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Use --password-stdin to sign in from a pipe.");
  process.stderr.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003" || character === "\u0004") return finish(new Error("Sign-in cancelled."));
        if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}
