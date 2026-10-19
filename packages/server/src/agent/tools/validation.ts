import Ajv from "ajv";
import type { Tool } from "./types.js";

/**
 * Phase 1 agent loop: single trusted validation point for model-generated tool
 * arguments. Every tool call from the model passes through `validateArgs`
 * BEFORE `guard()` and BEFORE `run()`. The registry owns the schemas; this
 * module only enforces them.
 *
 * Validator: ajv, JSON Schema draft 2020-12. Closed by default — the schemas
 * in the registry are the complete contract; `additionalProperties` defaults
 * are left to each tool's own schema (tools that want strictness declare it).
 */

const ajv = new Ajv({ allErrors: true, strict: true });

export interface ArgsValidation {
  ok: boolean;
  /** Human-readable reason when !ok (fed back to the model). */
  error?: string;
}

/**
 * Validate `args` against `tool.parameters`. Returns {ok:true} or
 * {ok:false, error} — never throws. Unknown tool / non-object schema /
 * non-object args are all rejections, not exceptions.
 */
export function validateArgs(tool: Tool | undefined, args: unknown): ArgsValidation {
  if (!tool) return { ok: false, error: "unknown tool" };
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, error: `args for "${tool.name}" must be an object` };
  }
  const schema = tool.parameters;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { ok: false, error: `tool "${tool.name}" has no valid parameter schema` };
  }
  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema as Record<string, unknown>);
  } catch (err) {
    return { ok: false, error: `tool "${tool.name}" schema failed to compile: ${(err as Error).message}` };
  }
  const valid = validate(args);
  if (!valid) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
      .join("; ");
    return { ok: false, error: `args for "${tool.name}" failed validation: ${detail}` };
  }
  return { ok: true };
}
