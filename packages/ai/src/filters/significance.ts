export interface DiffInput {
  added: string;
  removed: string;
}

export interface SignificanceResult {
  worth: boolean;
  reason?: string;
}

/**
 * Heuristics to skip trivial diffs before paying for a classification call.
 * Conservative by design: when in doubt it returns `worth: true` — better to
 * classify a borderline diff than to silently drop a real signal.
 */
export function evaluateSignificance(diff: DiffInput): SignificanceResult {
  const combined = `${diff.added}\n${diff.removed}`;
  const trimmed = combined.replace(/\s+/g, "");

  // 1. Globally too short.
  if (trimmed.length < 50) {
    return { worth: false, reason: "too_short" };
  }

  // 2. Not enough significant characters (excluding digits, dates, punctuation).
  const significant = combined.replace(/[\s\d:/.\-,;()[\]{}_+@#'"]/g, "").length;
  if (significant < 30) {
    return { worth: false, reason: "no_significant_text" };
  }

  // 3. Only hashes / UUIDs / long ids.
  if (/^[a-f0-9-]{20,}$/i.test(trimmed)) {
    return { worth: false, reason: "looks_like_hash" };
  }

  // 4. Only timestamps / dates / times.
  if (/^[\d\s\-:T/.,Z+]+$/.test(combined)) {
    return { worth: false, reason: "timestamps_only" };
  }

  // 5. CSRF / nonce / random token (a single long random word, no spaces).
  if (/^[A-Za-z0-9+/=]{30,}$/.test(trimmed) && !combined.includes(" ")) {
    return { worth: false, reason: "looks_like_token" };
  }

  return { worth: true };
}
