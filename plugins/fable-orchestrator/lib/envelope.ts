// Validation and extraction of the structured worker result envelopes the
// backends return. These are pure functions of their input text/objects so
// they can be exercised directly without spawning a backend.

export function validateResult(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("result is not an object");
  }

  const result = value as Record<string, unknown>;
  if (!["completed", "blocked"].includes(String(result.status))) {
    throw new Error("result.status is invalid");
  }

  if (typeof result.summary !== "string") {
    throw new Error("result.summary is invalid");
  }

  for (const key of ["changes", "verification", "risks", "next_actions"]) {
    const items = result[key];
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
      throw new Error(`result.${key} is invalid`);
    }
  }
}

// Composer frequently wraps the requested JSON object in a Markdown code
// fence even when told to return bare JSON.
export function stripCodeFences(text: string): string {
  const match = text.trim().match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

export function extractComposerResult(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const candidates: unknown[] = [
    envelope,
    envelope.result,
    envelope.text,
    envelope.message,
  ];

  for (const candidate of candidates) {
    let parsed = candidate;

    if (typeof candidate === "string") {
      try {
        parsed = JSON.parse(stripCodeFences(candidate));
      } catch {
        const embeddedResults: Record<string, unknown>[] = [];
        let objectStart = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = 0; index < candidate.length; index += 1) {
          const character = candidate[index];

          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (character === "\\") {
              escaped = true;
            } else if (character === '"') {
              inString = false;
            }
            continue;
          }

          if (character === '"') {
            inString = true;
          } else if (character === "{") {
            if (depth === 0) {
              objectStart = index;
            }
            depth += 1;
          } else if (character === "}" && depth > 0) {
            depth -= 1;
            if (depth === 0 && objectStart >= 0) {
              try {
                const embedded = JSON.parse(
                  candidate.slice(objectStart, index + 1),
                );
                validateResult(embedded);
                embeddedResults.push(embedded);
              } catch {
                // Continue scanning for a later valid result object.
              }
              objectStart = -1;
            }
          }
        }

        const embeddedResult = embeddedResults.at(-1);
        if (embeddedResult) {
          return embeddedResult;
        }
        continue;
      }
    }

    try {
      validateResult(parsed);
      return parsed;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Cursor did not return the required structured result. Composer may still have changed files; inspect the worktree and run verification before deciding whether the implementation failed.",
  );
}

export function extractClaudeResult(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of ["structured_output", "structuredOutput"] as const) {
    const candidate = envelope[key];
    if (candidate === undefined || candidate === null) {
      continue;
    }

    try {
      validateResult(candidate);
      return candidate as Record<string, unknown>;
    } catch {
      if (typeof candidate === "string") {
        try {
          const parsed = JSON.parse(stripCodeFences(candidate));
          validateResult(parsed);
          return parsed;
        } catch {
          continue;
        }
      }
    }
  }

  return extractComposerResult(envelope);
}
