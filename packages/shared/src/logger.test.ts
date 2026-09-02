import { describe, expect, test } from "bun:test";
import pino from "pino";
import { baseOptions } from "./logger";

// The redact list is a production safety control, not a formatting preference: it is
// what keeps a session token, a customer email and the Postgres URL out of the log
// drain. Nothing verified that pino actually applies it — a typo in a path, or a
// nesting depth the wildcard doesn't reach, fails completely silently. These tests
// run the real `baseOptions` through a real pino instance and read the emitted JSON.

/** Log `obj` through a pino built from the shipped options and return the record. */
function emit(obj: Record<string, unknown>): Record<string, unknown> {
  let line = "";
  const logger = pino(baseOptions, { write: (chunk: string) => (line += chunk) });
  logger.info(obj, "msg");
  return JSON.parse(line) as Record<string, unknown>;
}

const CENSOR = "[REDACTED]";

describe("logger redaction — one level of nesting", () => {
  // Every `*.x` path in the list, exercised at the depth it is written for.
  const wildcards = [
    "password",
    "token",
    "apiKey",
    "api_key",
    "secret",
    "authorization",
    "email",
    "stripeCustomerId",
    "file",
  ] as const;

  for (const field of wildcards) {
    test(`{ user: { ${field} } } is censored`, () => {
      const out = emit({ user: { [field]: "sensitive-value", id: "u1" } });
      const user = out.user as Record<string, unknown>;
      expect(user[field]).toBe(CENSOR);
      // Only the named field goes — a redact rule that swallowed the whole object
      // would make every log around it useless and nobody would notice.
      expect(user.id).toBe("u1");
    });
  }
});

describe("logger redaction — literal paths", () => {
  test("req.headers.authorization and req.headers.cookie are censored", () => {
    const out = emit({
      req: {
        headers: { authorization: "Bearer live-token", cookie: "session=abc", host: "app" },
      },
    });
    const headers = (out.req as Record<string, Record<string, unknown>>).headers;
    expect(headers.authorization).toBe(CENSOR);
    expect(headers.cookie).toBe(CENSOR);
    expect(headers.host).toBe("app");
  });

  test("req.body never reaches the log (zero-storage guarantee for uploads)", () => {
    const out = emit({ req: { body: "%PDF-1.7 …raw bytes…", method: "POST" } });
    const req = out.req as Record<string, unknown>;
    expect(req.body).toBe(CENSOR);
    expect(req.method).toBe("POST");
  });

  test("a top-level DATABASE_URL is censored", () => {
    const out = emit({ DATABASE_URL: "postgres://user:pw@host/db", env: "prod" });
    expect(out.DATABASE_URL).toBe(CENSOR);
    expect(out.env).toBe("prod");
  });
});

// The list's shape has consequences, and they are the ones that bite. Pinning them
// here means a future reader learns the limit from a passing test instead of from a
// leak: `*.x` is exactly ONE level, so neither a bare top-level field nor anything
// two levels down is covered.
describe("logger redaction — the documented gaps", () => {
  test("a TOP-LEVEL secret is NOT covered by `*.secret`", () => {
    const out = emit({ token: "live-token", password: "hunter2" });
    expect(out.token).toBe("live-token");
    expect(out.password).toBe("hunter2");
  });

  test("a secret TWO levels down is NOT covered either", () => {
    const out = emit({ ctx: { user: { token: "live-token" } } });
    const user = (out.ctx as Record<string, Record<string, unknown>>).user;
    expect(user.token).toBe("live-token");
  });

  test("a differently-named secret field passes through", () => {
    // `accessToken` / `refreshToken` are the field names the OAuth token store uses.
    const out = emit({ oauth: { accessToken: "at", refreshToken: "rt" } });
    const oauth = out.oauth as Record<string, unknown>;
    expect(oauth.accessToken).toBe("at");
    expect(oauth.refreshToken).toBe("rt");
  });

  test("so log a secret-bearing object one level deep, under its own key", () => {
    // The safe shape, and the reason the gaps above are acceptable rather than a bug:
    // `logger.error({ err, context })` puts the payload exactly one level down.
    const out = emit({ context: { email: "a@b.c", apiKey: "k", monitorId: "m1" } });
    const ctx = out.context as Record<string, unknown>;
    expect(ctx.email).toBe(CENSOR);
    expect(ctx.apiKey).toBe(CENSOR);
    expect(ctx.monitorId).toBe("m1");
  });
});

describe("logger options", () => {
  test("the censor is a constant string, never a partial mask", () => {
    // A partial mask ("sk-…3f9") narrows a brute force; the list censors outright.
    expect((baseOptions.redact as { censor: string }).censor).toBe(CENSOR);
  });

  test("LOG_LEVEL is honoured, defaulting to info", () => {
    expect(baseOptions.level).toBe(process.env.LOG_LEVEL ?? "info");
  });
});
