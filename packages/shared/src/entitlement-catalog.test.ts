import { test, expect, describe } from "bun:test";
import {
  ENTITLEMENT_CATALOG,
  resolveFeatureSlug,
  slugifyFeatureLabel,
  normalizeFeatureLabel,
} from "./entitlement-catalog";

describe("catalog shape", () => {
  test("has the promised ~30-40 canonical slugs, all unique", () => {
    const slugs = ENTITLEMENT_CATALOG.map((e) => e.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(30);
    expect(slugs.length).toBeLessThanOrEqual(45);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("resolveFeatureSlug — English", () => {
  const cases: Array<[string, string]> = [
    ["Single sign-on (SSO)", "sso"],
    ["SAML SSO", "sso"],
    ["SCIM provisioning", "sso_scim"],
    ["Two-factor authentication", "two_factor_auth"],
    ["Custom roles & permissions", "custom_roles"],
    ["Up to 5 users", "seats_included"],
    ["Unlimited seats", "seats_included"],
    ["API access", "api_access"],
    ["10,000 API calls / month", "api_calls"],
    ["Rate limits", "api_rate_limit"],
    ["Webhooks", "webhooks"],
    ["Audit log", "audit_log"],
    ["Audit trail", "audit_log"],
    ["30-day version history", "version_history"],
    ["90-day data retention", "retention"],
    ["Data export (CSV)", "exports"],
    ["Daily backups", "backups"],
    ["SOC 2 Type II", "compliance_certs"],
    ["99.9% uptime SLA", "sla"],
    ["Priority support", "priority_support"],
    ["Dedicated customer success manager", "dedicated_support"],
    ["Email support", "support_tier"],
    ["White-label", "white_label"],
    ["Remove branding", "white_label"],
    ["Custom fields", "custom_fields"],
    ["Advanced analytics", "analytics"],
    ["Workflows & automations", "automations"],
    ["Sandbox environment", "sandbox"],
    ["Custom domain", "custom_domain"],
    ["Self-hosted deployment", "on_premise"],
    ["100 GB storage", "storage"],
    ["AI credits", "credits"],
  ];
  for (const [label, slug] of cases) {
    test(`"${label}" → ${slug}`, () => {
      const r = resolveFeatureSlug(label);
      expect(r.slug).toBe(slug);
      expect(r.isCanonical).toBe(true);
    });
  }
});

describe("resolveFeatureSlug — FR/DE/ES/IT/NL/PT aliases", () => {
  const cases: Array<[string, string]> = [
    ["Authentification unique", "sso"],
    ["Utilisateurs illimités", "seats_included"],
    ["Journal d'audit", "audit_log"],
    ["Journal d’audit", "audit_log"], // curly apostrophe, as pages render it
    ["Rétention des données 90 jours", "retention"],
    ["Support prioritaire", "priority_support"],
    ["Assistance par e-mail", "support_tier"],
    ["Marque blanche", "white_label"],
    ["Champs personnalisés", "custom_fields"],
    ["Rôles personnalisés", "custom_roles"],
    ["100 Go de stockage", "storage"],
    ["Benutzerdefinierte Rollen", "custom_roles"],
    ["Audit-Protokoll", "audit_log"],
    ["Prioritärer Support", "support_tier"],
    ["Unbegrenzte Benutzer", "seats_included"],
    ["Aufbewahrung", "retention"],
    ["Soporte prioritario", "priority_support"],
    ["Usuarios incluidos", "seats_included"],
    ["Registro de auditoría", "audit_log"],
    ["Utenti illimitati", "seats_included"],
    ["Supporto dedicato", "dedicated_support"],
    ["Aangepaste rollen", "custom_roles"],
    ["Gebruikers", "seats_included"],
    ["Suporte prioritário", "priority_support"],
  ];
  for (const [label, slug] of cases) {
    test(`"${label}" → ${slug}`, () => {
      const r = resolveFeatureSlug(label);
      expect(r.slug).toBe(slug);
      expect(r.isCanonical).toBe(true);
    });
  }
});

describe("free-text fallback", () => {
  test("an unknown label slugifies deterministically, non-canonical", () => {
    const r = resolveFeatureSlug("Real-time collaborative whiteboard");
    expect(r).toEqual({ slug: "real_time_collaborative_whiteboard", isCanonical: false });
  });

  test("slugify strips diacritics, punctuation, and bounds length", () => {
    expect(slugifyFeatureLabel("  Éditeur   avancé!! ")).toBe("editeur_avance");
    expect(slugifyFeatureLabel("x".repeat(200)).length).toBeLessThanOrEqual(60);
    expect(slugifyFeatureLabel("???")).toBe("unlabeled");
  });

  test("ordinary prose does not accidentally hit a canonical slug", () => {
    // "to" is a French storage unit only after a number; "history of" is prose.
    expect(resolveFeatureSlug("Up to everything you need").isCanonical).toBe(false);
    expect(resolveFeatureSlug("A brief history of our company").isCanonical).toBe(false);
  });
});

describe("normalizeFeatureLabel", () => {
  test("lowercases, collapses whitespace, strips accents", () => {
    expect(normalizeFeatureLabel("  Rétention   des Données ")).toBe(
      "retention des donnees",
    );
  });
});
