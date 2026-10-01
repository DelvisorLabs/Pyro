import { RE2JS } from "re2js";
import type { LocalRule, TextStep } from "@pyro/contracts";

export interface LocalRuleMatch {
  rule: LocalRule;
  matchedValue: string;
}

const MAX_TRAVERSED_VALUES = 50_000;

function collectStrings(value: unknown, output: string[]): boolean {
  const pending = [value];
  const seen = new WeakSet<object>();
  let traversed = 0;
  while (pending.length > 0 && traversed < MAX_TRAVERSED_VALUES) {
    const current = pending.pop();
    traversed += 1;
    if (typeof current === "string") {
      output.push(current);
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    pending.push(...(Array.isArray(current) ? current : Object.values(current as Record<string, unknown>)));
  }
  return pending.length === 0;
}

function collectToolNames(value: unknown, output: string[]): void {
  const pending = [value];
  const seen = new WeakSet<object>();
  let traversed = 0;
  while (pending.length > 0 && traversed < MAX_TRAVERSED_VALUES) {
    const current = pending.pop();
    traversed += 1;
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      const normalized = key.toLowerCase();
      const explicitToolName = ["tool", "toolname", "tool_name"].includes(normalized);
      const functionName = normalized === "name" && (
        "arguments" in record
        || "parameters" in record
        || record.type === "function"
        || record.type === "tool"
      );
      if ((explicitToolName || functionName) && typeof item === "string") output.push(item);
      pending.push(item);
    }
  }
}

const regexCache = new Map<string, RE2JS>();

function matches(rule: LocalRule, candidate: string): boolean {
  if (rule.match === "regex") {
    const key = `${rule.caseSensitive}:${rule.pattern}`;
    let regex = regexCache.get(key);
    if (!regex) {
      regex = RE2JS.compile(rule.pattern, rule.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
      if (regexCache.size >= 256) regexCache.clear();
      regexCache.set(key, regex);
    }
    return regex.matcher(candidate).find();
  }
  const left = rule.caseSensitive ? candidate : candidate.toLowerCase();
  const right = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();
  return rule.match === "equals" ? left === right : left.includes(right);
}

export function evaluateLocalRules(input: unknown, rules: LocalRule[]): LocalRuleMatch[] {
  const allText: string[] = [];
  const toolNames: string[] = [];
  collectStrings(input, allText);
  collectToolNames(input, toolNames);
  let rawJson = "";
  try {
    rawJson = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    rawJson = "";
  }
  return rules
    .filter((rule) => rule.enabled)
    .flatMap((rule) => {
      const candidates = rule.scope === "tool_name" ? toolNames : rule.scope === "raw_json" ? [rawJson] : allText;
      const matchedValue = candidates.find((candidate) => matches(rule, candidate));
      return matchedValue === undefined ? [] : [{ rule, matchedValue }];
    })
    .sort((left, right) => {
      if (left.rule.action !== right.rule.action) return left.rule.action === "block" ? -1 : 1;
      return right.rule.risk - left.rule.risk;
    });
}

export function matchTextStep(input: unknown, step: TextStep): { matched: boolean; evidence: string } {
  const candidates: string[] = [];
  if (!collectStrings(input, candidates)) throw new Error("The input exceeds the text check's traversal limit.");
  if (step.match === "word_list") {
    const normalize = (word: string) => step.caseSensitive ? word : word.toLowerCase();
    const tokens = new Set(candidates.flatMap((text) => text.match(/[\p{L}\p{N}_]+/gu) ?? []).map(normalize));
    const word = step.words.find((term) => tokens.has(normalize(term)));
    return { matched: word !== undefined, evidence: word === undefined ? "No configured whole word matched." : `Matched configured word: ${word}` };
  }
  const rule: LocalRule = { ...step, description: "", enabled: true, scope: "all_text", match: step.match, action: "block", risk: 1 };
  const matched = candidates.some((text) => matches(rule, text));
  // Trace evidence describes configured rules, never copies sensitive input.
  return { matched, evidence: `${matched ? "Matched" : "Did not match"} ${step.match} pattern: ${step.pattern.slice(0, 160)}` };
}
