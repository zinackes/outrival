# Legal & compliance — Outrival

Master reference for the site's legal layer (mentions légales, privacy, cookies,
terms, CGV, DPA, subprocessors, acceptable use, accessibility, AI transparency).
Built to the **EU/FR regulatory baseline as of July 2026**.

> ⚠️ **Not legal advice.** These documents are drafted to the current regulatory
> baseline and to SaaS best practice, but Outrival scrapes third-party sites — a
> legally sensitive activity. Have a lawyer specialised in tech/data review them
> before relying on them in production, especially the scraping stance (privacy
> §4, terms §6–8, acceptable use) and the CGV consumer clauses.

## Parameters this was built against

- **Entity:** not incorporated yet → the eight identity fields are placeholders
  (`[À COMPLÉTER]`) and are published as such on `/legal-notice`, `/privacy` and
  `/terms-of-sale`. `apps/web/test/legal-contacts.test.ts` pins that list, so
  filling one of them fails until this checklist is updated with it.
- **Audience:** B2B **and** B2C → consumer rights included (14-day withdrawal,
  withdrawal button, mediation).
- **Language:** bilingual **FR + EN** with a per-document toggle.
- **Size:** micro-enterprise → accessibility statement is voluntary/light (no
  full RGAA multi-year scheme).

## Documents & routes

| Document | Route | Regulatory basis |
|---|---|---|
| Legal Notice / Mentions légales | `/legal-notice` | LCEN art. 6 (mod. loi SREN 2024) |
| Privacy Policy | `/privacy` | GDPR art. 13–14; French Data Protection Act |
| Cookie Policy | `/cookies` | ePrivacy; CNIL cookie recommendation (consolidated Jan 2026) |
| Terms of Service (CGU) | `/terms` | Contract; consumer + civil law |
| Terms of Sale (CGV) | `/terms-of-sale` | Consumer Code (withdrawal L.221-21, online cancellation), VAT |
| Data Processing Agreement | `/dpa` | GDPR art. 28 |
| Subprocessors | `/subprocessors` | GDPR art. 28(2)(4); rendered from `entity.ts` |
| Acceptable Use Policy | `/acceptable-use` | Contract; scraping stance |
| Accessibility Statement | `/accessibility` | European Accessibility Act (28 Jun 2025) / RGAA |
| Legal Center (hub) | `/legal` | index of the above |
| AI transparency | in `AskPanel` UI + privacy §5 + terms §7 | EU AI Act art. 50 (applies 2 Aug 2026) |

## Architecture

- `apps/web/src/lib/legal/entity.ts` — **single source of truth** for identity,
  contacts, host, version/date and the subprocessor list. Edit here → every page
  updates.
- `apps/web/src/components/legal/legal-doc.tsx` — bilingual shell + FR/EN toggle
  (choice persisted in `localStorage: outrival.legal.lang`), built on `DocPage`.
- Cookie consent: `consent-banner.tsx` (Accept / Reject / Customize, CNIL
  symmetry) + `lib/consent.ts` + `cookie-preferences-button.tsx` (re-open from
  the footer). PostHog is opt-in only.

## ⛔ Placeholders to fill before production

All live in `apps/web/src/lib/legal/entity.ts` unless noted. A missing/false
SIRET or RCS is a real legal exposure — do **not** ship with placeholders.

- [ ] `ENTITY.legalName`, `legalForm`, `capital`, `siret`, `rcs`, `vat`,
      `address`, `publicationDirector` — on incorporation.
- [ ] `HOST` — confirm the actual website host (prod = OVHcloud per deploy notes;
      architecture doc also mentions Hetzner). OVHcloud public details are
      pre-filled; correct if wrong.
- [x] `CONTACT.privacy` and `CONTACT.security` — both point at
      `hello@outrival.app` (the one live inbox). The dedicated `privacy@` /
      `security@` addresses were published while nothing routed them, so a GDPR
      request or a vulnerability report sent there reached nobody. Provision the
      two mailboxes and flip the constants back in the same change;
      `apps/web/test/legal-contacts.test.ts` guards the order.
- [ ] CGV: confirm **VAT** treatment at checkout and add the **consumer mediator**
      details (mandatory for B2C) once appointed.
- [ ] Verify `TURNSTILE_SECRET_KEY` is set on prod (referenced by the cookie table
      as a necessary cookie).

## 🔧 Follow-up engineering (not blocking the docs, but required for full compliance)

- [ ] **In-app withdrawal button** (Consumer Code L.221-21, in force since 19 Jun
      2026) for B2C subscriptions — the CGV references it; implement the actual
      button in the billing UI before selling to consumers.
- [ ] **Server-side PostHog consent**: `apps/api` and `apps/workers` `posthog-node`
      events are not consent-gated. Client analytics is gated; confirm server
      events are pseudonymised/necessary or gate them.
- [ ] **Subprocessor DPAs / SCCs**: ensure a signed DPA + EU SCCs are in place with
      each subprocessor listed on `/subprocessors` (Stripe, Resend, Trigger.dev,
      AI providers, etc.).
- [ ] **Cookie audit**: verify the exact cookies Stripe/Turnstile set in prod and
      keep the `/cookies` table accurate.
- [ ] **AI Act marking** (art. 50(2), machine-readable marking of AI content) —
      grace period to 2 Dec 2026 for systems already on the market; the UI
      disclosure in `AskPanel` covers the interaction-transparency duty today.
- [ ] Redirect legacy domain `outrival.io` → `outrival.app` (canonical) so legal
      URLs are single-origin.

## Sources (July 2026)

- LCEN / mentions légales — legalplace.fr, francenum.gouv.fr, conformdocs.pro
- GDPR privacy / CNIL 2026 transparency action — cnil.fr, leto.legal
- CNIL cookies (consolidated recommendation, Jan 2026) — cnil.fr
- EU AI Act art. 50 (transparency, 2 Aug 2026; Omnibus grace to 2 Dec 2026) —
  artificialintelligenceact.eu, digital-strategy.ec.europa.eu
- Web scraping / EDPB Opinion 28/2024, legitimate interest, robots.txt — iapp.org,
  zyte.com
- CGV / withdrawal button L.221-21 (19 Jun 2026), online cancellation —
  martin.avocat.fr, backtome.fr, service-public.gouv.fr
- GDPR art. 28 DPA + subprocessors — gdpr-info.eu, EDPB guidance
- European Accessibility Act (28 Jun 2025) / RGAA — accessibilite.numerique.gouv.fr,
  access42.net
