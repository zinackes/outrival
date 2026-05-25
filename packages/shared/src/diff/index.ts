import { createHash } from "node:crypto";
import { diffLines, type Change as DiffChange } from "diff";

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface TextDiffResult {
  hasChanges: boolean;
  added: string[];
  removed: string[];
  diffText: string;
}

export function computeTextDiff(before: string, after: string): TextDiffResult {
  const changes: DiffChange[] = diffLines(before, after);
  const added: string[] = [];
  const removed: string[] = [];

  for (const part of changes) {
    if (part.added) added.push(part.value.trim());
    if (part.removed) removed.push(part.value.trim());
  }

  const diffText = [
    ...removed.map((l) => `- ${l}`),
    ...added.map((l) => `+ ${l}`),
  ].join("\n");

  return {
    hasChanges: added.length > 0 || removed.length > 0,
    added,
    removed,
    diffText,
  };
}
