// IMAP poller for the production E2E audit (card A3).
//
// Deliverability is a fact about production that only a real mailbox can
// measure, so this watches INBOX *and* the spam folder and reports which one
// the message landed in, and how long it took. "It arrived" is not the finding;
// "it arrived in 34s, in Spam" is.
//
//   bun scripts/poll-inbox.ts --subject "sign in" --timeout 120
//   bun scripts/poll-inbox.ts --since-now --from auth@outrival.io
//
// Env (never commit these — put them in .env.local, which is gitignored):
//   AUDIT_IMAP_HOST      e.g. imap.gmail.com
//   AUDIT_IMAP_PORT      default 993
//   AUDIT_IMAP_USER      the audit mailbox address
//   AUDIT_IMAP_PASSWORD  an app password, NOT the account password
//   AUDIT_IMAP_SPAM_BOX  default "[Gmail]/Spam"
//
// Prints JSON: { folder, delaySeconds, subject, from, codes[], links[] }.

import { ImapFlow } from "imapflow";

type Args = {
  subject?: string;
  from?: string;
  timeout: number;
  interval: number;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    subject: get("--subject"),
    from: get("--from"),
    timeout: Number(get("--timeout") ?? 180),
    interval: Number(get("--interval") ?? 10),
  };
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    throw new Error(
      `${name} is not set. The audit mailbox credentials live in .env.local; see the header of this file.`
    );
  }
  return v;
}

/** 6-digit sign-in codes, as sent by the email-OTP plugin. */
function extractCodes(text: string): string[] {
  return [...new Set(text.match(/\b\d{6}\b/g) ?? [])];
}

function extractLinks(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>)]+/g) ?? [])].slice(0, 20);
}

async function searchFolder(
  client: ImapFlow,
  folder: string,
  since: Date,
  args: Args
) {
  const lock = await client.getMailboxLock(folder);
  try {
    const uids = await client.search({ since });
    // Newest first: during a retry the latest message is the one we want.
    for (const uid of (uids ?? []).slice(-25).reverse()) {
      const msg = await client.fetchOne(String(uid), {
        envelope: true,
        source: true,
      });
      if (!msg || !msg.envelope) continue;

      const subject = msg.envelope.subject ?? "";
      const fromAddr = msg.envelope.from?.[0]?.address ?? "";
      const date = msg.envelope.date ?? new Date();

      if (date < since) continue;
      if (args.subject && !subject.toLowerCase().includes(args.subject.toLowerCase()))
        continue;
      if (args.from && !fromAddr.toLowerCase().includes(args.from.toLowerCase()))
        continue;

      const body = msg.source?.toString("utf8") ?? "";
      return {
        folder,
        receivedAt: date.toISOString(),
        delaySeconds: Math.round((date.getTime() - since.getTime()) / 1000),
        subject,
        from: fromAddr,
        codes: extractCodes(body),
        links: extractLinks(body).filter((l) => l.includes("outrival")),
      };
    }
    return null;
  } finally {
    lock.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spamBox = process.env.AUDIT_IMAP_SPAM_BOX ?? "[Gmail]/Spam";

  const client = new ImapFlow({
    host: env("AUDIT_IMAP_HOST"),
    port: Number(process.env.AUDIT_IMAP_PORT ?? 993),
    secure: true,
    auth: {
      user: env("AUDIT_IMAP_USER"),
      pass: env("AUDIT_IMAP_PASSWORD"),
    },
    logger: false,
  });

  await client.connect();
  // Anchor the clock before the trigger action, so the delay we report is the
  // real end-to-end one rather than "time since we started looking".
  const since = new Date(Date.now() - 60_000);
  const deadline = Date.now() + args.timeout * 1000;

  try {
    while (Date.now() < deadline) {
      for (const folder of ["INBOX", spamBox]) {
        try {
          const hit = await searchFolder(client, folder, since, args);
          if (hit) {
            console.log(JSON.stringify(hit, null, 1));
            return;
          }
        } catch {
          // A missing spam folder is not a failure — providers name it
          // differently, and INBOX alone still answers the main question.
        }
      }
      await new Promise((r) => setTimeout(r, args.interval * 1000));
    }
    console.log(
      JSON.stringify({ error: "timeout", waitedSeconds: args.timeout }, null, 1)
    );
    process.exitCode = 1;
  } finally {
    await client.logout().catch(() => {});
  }
}

await main();
