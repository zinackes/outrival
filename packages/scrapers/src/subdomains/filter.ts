/**
 * Subdomain enumeration via Certificate Transparency (crt.sh). Pure parsing +
 * classification — AI-free, no network (the fetch lives in crtsh.ts, the liveness
 * probe in liveness.ts). A newly-appearing LIVE subdomain (beta./ai./{product}.)
 * is an expansion / pre-announcement product signal; this module turns a crt.sh
 * JSON payload into a deduped, infra-filtered, kind-tagged candidate list the
 * scraper renders into a deterministic sorted snapshot.
 */
import { normalizeHostname } from "@outrival/shared";
import type { CrtShEntry } from "./crtsh";

export type SubdomainKind = "beta" | "product" | "regional" | "other";

export interface SubdomainCandidate {
  /** Fully-qualified host, lowercased, wildcard-stripped. */
  host: string;
  /** Leftmost sub-label (`beta` for beta.acme.com) — drives kind + annotation. */
  label: string;
  kind: SubdomainKind;
  /** Most-recent cert `not_before` seen for this host (ms), for recency capping. */
  seenMs: number;
}

// Leftmost-label vocabularies. `beta` = pre-announcement product surface (steer
// the classifier high); `regional` = geographic expansion (steer medium). Kept
// deliberately small — the fallback "unknown token → product" is what catches
// genuinely novel surfaces (ai., studio., canvas.), which are the whole point.
const BETA_LABELS = new Set([
  "beta", "alpha", "preview", "canary", "next", "insiders", "early", "rc",
  "labs", "experimental", "nightly", "edge",
]);
const REGION_LABELS = new Set([
  "eu", "us", "uk", "de", "fr", "es", "it", "nl", "br", "ca", "au", "in",
  "jp", "kr", "cn", "sg", "mx", "ru", "pt", "se", "no", "dk", "fi", "pl",
  "tr", "za", "ie", "ch", "at", "be", "apac", "emea", "asia", "latam", "uae",
]);
// Known generic surfaces — real subdomains but low novelty (an app/help/docs
// host tells us little). Classified `other`, kept in the snapshot but not steered
// up. NOTE: infra labels (mail/ns/dev/admin…) are dropped earlier by isInfra and
// never reach classifyKind.
const GENERIC_LABELS = new Set([
  "app", "apps", "api", "help", "support", "docs", "doc", "blog", "status",
  "careers", "jobs", "community", "forum", "portal", "account", "accounts",
  "my", "go", "get", "share", "dashboard", "console", "login", "auth", "sso",
  "id", "connect", "developer", "developers", "partners", "partner", "store",
  "shop", "pay", "billing", "secure", "www2",
]);

// Pure infrastructure / operational hosts — never a product signal. Dropped
// before the liveness probe so we don't spend DNS/HEAD budget on them.
const INFRA_LABELS = new Set([
  "www", "mail", "mx", "smtp", "imap", "pop", "pop3", "ftp", "sftp", "webmail",
  "email", "mailer", "mta", "relay", "bounce", "bounces", "mg", "em",
  "cpanel", "whm", "webdisk", "autodiscover", "autoconfig",
  "ns", "ns1", "ns2", "ns3", "ns4", "dns", "vpn", "remote", "gw", "gateway",
  "proxy", "cdn", "static", "assets", "img", "images", "media", "fonts",
  "hosting", "host", "server", "mailin", "spf", "dkim", "dmarc", "smtp2",
  "internal", "intra", "intranet", "corp", "admin", "qa", "test", "staging",
  "stg", "dev", "sandbox", "ci", "jenkins", "git", "gitlab", "grafana",
  "kibana", "prometheus", "vault", "k8s",
]);

/**
 * Split the part of `host` BELOW the registrable domain into its labels.
 * `s3-x.cf.staging.acme.com` / `acme.com` → ["s3-x", "cf", "staging"].
 * Returns [] when host IS the apex (no sub-labels) or isn't under the domain.
 */
export function subLabels(host: string, registrableDomain: string): string[] {
  if (host === registrableDomain) return [];
  const suffix = `.${registrableDomain}`;
  if (!host.endsWith(suffix)) return [];
  return host.slice(0, -suffix.length).split(".").filter(Boolean);
}

// Hashed / generated CDN-style labels: long hex blobs, UUID fragments, or very
// long random strings. These are per-deploy noise, never a named product surface.
function isHashedLabel(label: string): boolean {
  if (/^[a-f0-9]{16,}$/.test(label)) return true; // pure hex blob
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-/.test(label)) return true; // UUID fragment
  if (label.length >= 25) return true; // absurdly long generated label
  return false;
}

/**
 * Infra / noise host to drop before liveness. A host is infra when: it's the
 * apex itself, it nests too deep (≥3 sub-labels ⇒ generated/CDN), any label is
 * a `_`-prefixed record (_dmarc/_domainkey/_acme-challenge), any label is a
 * hashed blob, the leftmost label is `s3-`/`k8s-`-prefixed, or ANY label is in
 * INFRA_LABELS (catches `x.staging.acme.com` as well as `mail.acme.com`).
 */
export function isInfra(host: string, registrableDomain: string): boolean {
  const labels = subLabels(host, registrableDomain);
  if (labels.length === 0) return true; // apex — not a "subdomain"
  if (labels.length >= 3) return true; // deep nesting ⇒ generated/CDN host
  for (const l of labels) {
    if (l.startsWith("_")) return true;
    if (isHashedLabel(l)) return true;
    if (INFRA_LABELS.has(l)) return true;
  }
  const first = labels[0]!;
  if (first.startsWith("s3-") || first.startsWith("k8s-") || first.startsWith("kube")) {
    return true;
  }
  return false;
}

/** Classify a kept (non-infra) host by its leftmost sub-label. */
export function classifyKind(host: string, registrableDomain: string): SubdomainKind {
  const label = subLabels(host, registrableDomain)[0] ?? "";
  if (BETA_LABELS.has(label) || label.startsWith("beta") || label.startsWith("new-")) {
    return "beta";
  }
  if (REGION_LABELS.has(label)) return "regional";
  if (GENERIC_LABELS.has(label)) return "other";
  return "product"; // unknown token ⇒ likely a novel product surface
}

/**
 * From raw crt.sh entries → deduped, wildcard-stripped, infra-filtered candidate
 * hosts, tagged with kind + recency. The dedup collapses the precert/leaf pair
 * (crt.sh logs BOTH, same names / different id — there is no entry_type field to
 * select precerts by, so hostname-set dedup is the robust equivalent) into one
 * entry per host. `registrableDomain` locks results to the competitor's own
 * domain (crt.sh %25.domain can return sibling/CN noise).
 */
export function selectCandidates(
  entries: CrtShEntry[],
  registrableDomain: string,
): SubdomainCandidate[] {
  const suffix = `.${registrableDomain}`;
  const byHost = new Map<string, number>(); // host → max not_before ms
  for (const e of entries) {
    const raw = `${e.common_name ?? ""}\n${e.name_value ?? ""}`;
    const seenMs = e.not_before ? new Date(e.not_before).getTime() : 0;
    for (const piece of raw.split("\n")) {
      let host = piece.trim().toLowerCase();
      if (!host) continue;
      if (host.startsWith("*.")) host = host.slice(2); // strip wildcard
      if (host.includes("*")) continue; // any residual wildcard ⇒ skip
      if (host !== registrableDomain && !host.endsWith(suffix)) continue; // own domain only
      const prev = byHost.get(host) ?? 0;
      if (!byHost.has(host) || (Number.isFinite(seenMs) && seenMs > prev)) {
        byHost.set(host, Number.isFinite(seenMs) ? seenMs : prev);
      }
    }
  }

  const out: SubdomainCandidate[] = [];
  for (const [host, seenMs] of byHost) {
    if (isInfra(host, registrableDomain)) continue;
    out.push({
      host,
      label: subLabels(host, registrableDomain)[0] ?? "",
      kind: classifyKind(host, registrableDomain),
      seenMs,
    });
  }
  // Most-recent first so a downstream cap keeps the freshest (likeliest-new) hosts.
  out.sort((a, b) => b.seenMs - a.seenMs || a.host.localeCompare(b.host));
  return out;
}
