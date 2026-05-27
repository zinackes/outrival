const MAX = 20;

export type ErrorEntry = { ts: number; message: string };

const buffer: ErrorEntry[] = [];
let installed = false;

export function initErrorBuffer(): void {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;

  const push = (msg: string) => {
    buffer.push({ ts: Date.now(), message: msg.slice(0, 500) });
    if (buffer.length > MAX) buffer.shift();
  };

  window.addEventListener("error", (e) =>
    push(`${e.message} @ ${e.filename}:${e.lineno}`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    push(`Unhandled rejection: ${String(e.reason)}`),
  );

  const orig = console.error;
  console.error = (...args: unknown[]) => {
    push(args.map(String).join(" "));
    orig(...args);
  };
}

export function getRecentErrors(): ErrorEntry[] {
  return [...buffer];
}
