# Phase 1 — Foundation

<context>
Le monorepo Outrival est initialisé avec sa structure de dossiers,
ses fichiers de config Claude Code (.claude/, CLAUDE.md, docs/),
et les package.json/tsconfig de base dans chaque app et package.

Aucun code applicatif n'existe encore. Cette phase pose les fondations
sur lesquelles toutes les phases suivantes s'appuient.

Lire impérativement avant de commencer :
- @CLAUDE.md
- @docs/architecture.md
- @task_plan.md
- @packages/db/CLAUDE.md
- @apps/api/CLAUDE.md
- @apps/web/CLAUDE.md
- @apps/workers/CLAUDE.md
</context>

<goal>
À la fin de cette phase :
- Le monorepo démarre sans erreur (pnpm dev)
- Un utilisateur peut s'inscrire, se connecter, et voir le dashboard
- Le schéma DB complet est en place et migré sur Railway PostgreSQL
- Trigger.dev v3 est configuré et un job de test s'exécute
- Zod valide toutes les variables d'environnement au démarrage
- pnpm build et pnpm typecheck passent à 0 erreur
</goal>

<task>

## Étape 0 — Installation de toutes les dépendances

Installer toutes les dépendances de la phase en une seule fois
avant d'écrire le moindre code.

```bash
# packages/shared
pnpm add zod --filter @outrival/shared
pnpm add -D typescript --filter @outrival/shared

# packages/db
pnpm add drizzle-orm postgres --filter @outrival/db
pnpm add -D drizzle-kit --filter @outrival/db

# apps/api
pnpm add hono better-auth zod --filter @outrival/api
pnpm add @outrival/db @outrival/shared --filter @outrival/api

# apps/web
pnpm add next react react-dom better-auth lucide-react --filter @outrival/web
pnpm add -D tailwindcss @tailwindcss/postcss --filter @outrival/web
pnpm add @outrival/shared --filter @outrival/web

# apps/workers
pnpm add @trigger.dev/sdk zod --filter @outrival/workers
pnpm add @outrival/db @outrival/shared --filter @outrival/workers
```

Ensuite initialiser shadcn/ui dans apps/web :
```bash
cd apps/web && pnpm dlx shadcn@latest init
```
Choisir : new-york style, zinc base color, CSS variables yes.

→ vérifier : pnpm install à la racine passe sans erreur

Commit : `chore(deps): install all phase 1 dependencies`

Exécuter dans cet ordre exact. Committer après chaque étape numérotée.

## Étape 1 — packages/shared

Créer les fondations partagées.

### packages/shared/src/types/result.ts
Type Result<T, E> utilisé partout dans le projet :
```typescript
export type Result =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok(value: T): Result {
  return { ok: true, value };
}

export function err(error: E): Result {
  return { ok: false, error };
}
```

### packages/shared/src/types/domain.ts
Types partagés inférés depuis Drizzle (à compléter après étape 2).

### packages/shared/src/constants/sources.ts
```typescript
export const SOURCE_TYPES = [
  "homepage", "pricing", "blog", "changelog", "jobs",
  "g2_reviews", "capterra_reviews", "appstore_reviews",
  "linkedin", "twitter"
] as const;

export type SourceType = typeof SOURCE_TYPES[number];

export const MONITOR_FREQUENCIES = ["realtime", "daily", "weekly"] as const;
export type MonitorFrequency = typeof MONITOR_FREQUENCIES[number];

export const SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export const SIGNAL_CATEGORIES = [
  "pricing", "product", "hiring", "reviews", "content", "funding"
] as const;
export type SignalCategory = typeof SIGNAL_CATEGORIES[number];
```

→ vérifier : pnpm typecheck --filter @outrival/shared

Commit : `feat(shared): add result type, domain constants`

---

## Étape 2 — packages/db

### packages/db/src/index.ts
Exporter le client DB et tous les schemas.

### packages/db/src/client.ts
Client Drizzle PostgreSQL Railway :
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
```

### packages/db/src/schema/ — un fichier par entité

**organizations.ts**
```typescript
import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "starter", "pro", "business"]);

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

**users.ts**
```typescript
import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const roleEnum = pgEnum("role", ["owner", "admin", "member"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: roleEnum("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**competitors.ts**
```typescript
import { pgTable, text, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const competitors = pgTable("competitors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  overlapScore: real("overlap_score"),
  category: text("category"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
```

**monitors.ts**
```typescript
import { pgTable, text, timestamp, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const sourceTypeEnum = pgEnum("source_type", [
  "homepage", "pricing", "blog", "changelog", "jobs",
  "g2_reviews", "capterra_reviews", "appstore_reviews",
  "linkedin", "twitter"
]);

export const frequencyEnum = pgEnum("frequency", ["realtime", "daily", "weekly"]);

export const monitors = pgTable("monitors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  frequency: frequencyEnum("frequency").notNull().default("daily"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**snapshots.ts**
```typescript
import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

export const snapshotStatusEnum = pgEnum("snapshot_status", [
  "success", "failed", "partial"
]);

export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  contentHash: text("content_hash").notNull(),
  status: snapshotStatusEnum("status").notNull().default("success"),
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
});
```

**changes.ts**
```typescript
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { monitors } from "./monitors";
import { snapshots } from "./snapshots";

export const changes = pgTable("changes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id").notNull().references(() => monitors.id),
  snapshotBeforeId: text("snapshot_before_id").references(() => snapshots.id),
  snapshotAfterId: text("snapshot_after_id").notNull().references(() => snapshots.id),
  diffText: text("diff_text"),
  diffType: text("diff_type"),
  rawDiff: jsonb("raw_diff"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});
```

**signals.ts**
```typescript
import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { changes } from "./changes";
import { organizations } from "./organizations";
import { competitors } from "./competitors";

export const severityEnum = pgEnum("severity", ["low", "medium", "high", "critical"]);
export const categoryEnum = pgEnum("category", [
  "pricing", "product", "hiring", "reviews", "content", "funding"
]);

export const signals = pgTable("signals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  changeId: text("change_id").notNull().references(() => changes.id),
  orgId: text("org_id").notNull().references(() => organizations.id),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  severity: severityEnum("severity").notNull(),
  category: categoryEnum("category").notNull(),
  insight: text("insight").notNull(),
  soWhat: text("so_what"),
  recommendedAction: text("recommended_action"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**digests.ts**
```typescript
import { pgTable, text, timestamp, jsonb, date } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const digests = pgTable("digests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id),
  weekStart: date("week_start").notNull(),
  weekEnd: date("week_end").notNull(),
  content: jsonb("content").notNull(),
  temperature: text("temperature"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**alerts.ts**
```typescript
import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { signals } from "./signals";
import { organizations } from "./organizations";

export const alertChannelEnum = pgEnum("alert_channel", ["email", "slack", "webhook"]);

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  signalId: text("signal_id").notNull().references(() => signals.id),
  orgId: text("org_id").notNull().references(() => organizations.id),
  channel: alertChannelEnum("channel").notNull(),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**job_postings.ts**
```typescript
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const jobPostings = pgTable("job_postings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  title: text("title").notNull(),
  department: text("department"),
  location: text("location"),
  url: text("url"),
  isActive: boolean("is_active").notNull().default(true),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});
```

**reviews.ts**
```typescript
import { pgTable, text, timestamp, real, pgEnum } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const reviewSourceEnum = pgEnum("review_source", [
  "g2", "capterra", "appstore", "playstore"
]);

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  source: reviewSourceEnum("source").notNull(),
  score: real("score"),
  content: text("content"),
  author: text("author"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});
```

### packages/db/src/schema/index.ts
Réexporter toutes les tables.

### packages/db/drizzle.config.ts
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

### packages/db/package.json scripts
```json
"db:push": "drizzle-kit push",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio",
"db:generate": "drizzle-kit generate"
```

Puis : pnpm db:push --filter @outrival/db

→ vérifier : toutes les tables créées sur Railway PostgreSQL

Commit : `feat(db): add drizzle schema with all core entities`

---

## Étape 3 — apps/api

### apps/api/src/env.ts
Validation Zod des variables d'environnement :
```typescript
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = EnvSchema.parse(process.env);
```

### apps/api/src/lib/db.ts
Import et réexport du client DB depuis @outrival/db.

### apps/api/src/lib/auth.ts
Better Auth configuré pour Hono :
```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "@outrival/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions, // Better Auth gère ses propres tables
    },
  }),
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
});
```

Note : Better Auth crée ses propres tables (user, session, account, verification).
Lancer `npx @better-auth/cli generate` après config pour les migrations Better Auth.

### apps/api/src/middleware/auth.ts
Middleware session pour Hono :
```typescript
import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth";

export const authMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});
```

### apps/api/src/routes/health.ts
```typescript
import { Hono } from "hono";

export const healthRouter = new Hono();

healthRouter.get("/", (c) => c.json({ status: "ok", service: "outrival-api" }));
```

### apps/api/src/index.ts
```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./env";
import { auth } from "./lib/auth";
import { healthRouter } from "./routes/health";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: process.env.NODE_ENV === "production"
    ? ["https://outrival.io"]
    : ["http://localhost:3000"],
  credentials: true,
}));

// Better Auth handler
app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));

// Routes
app.route("/health", healthRouter);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
```

→ vérifier : `curl http://localhost:3001/health` retourne `{"status":"ok"}`

Commit : `feat(api): add hono server with better-auth and health endpoint`

---

## Étape 4 — apps/web

### apps/web/src/lib/auth-client.ts
```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL!,
});

export const { useSession, signIn, signOut, signUp } = authClient;
```

### apps/web/src/app/layout.tsx
Layout racine avec import Syne + Inter depuis Google Fonts.
Fond sombre (#0C0C0F), texte blanc.

### apps/web/src/app/(auth)/login/page.tsx
Page login avec formulaire email/password.
Appelle `signIn.email()` de better-auth.
Redirect vers /dashboard si succès.

### apps/web/src/app/(auth)/register/page.tsx
Page inscription. Appelle `signUp.email()`.
Redirect vers /dashboard si succès.

### apps/web/src/app/(dashboard)/layout.tsx
Layout dashboard avec sidebar de navigation :
- Logo Outrival (Out en blanc, rival en amber #F59E0B, font Syne)
- Nav items avec icônes lucide-react :
  - Competitors (Users icon)
  - Digests (FileText icon)
  - Alerts (Bell icon)
  - Settings (Settings icon)
- Bouton Logout en bas
- Vérification session côté serveur — redirect /login si non connecté

### apps/web/src/app/(dashboard)/page.tsx
Redirect vers /dashboard/competitors.

### apps/web/src/app/(dashboard)/competitors/page.tsx
Page vide avec titre "Competitors" et message placeholder.

### apps/web/src/app/(dashboard)/digests/page.tsx
Page vide avec titre "Digests".

### apps/web/src/app/(dashboard)/alerts/page.tsx
Page vide avec titre "Alerts".

Design system à respecter :
- Fond : #0C0C0F (background), #16161A (cards/surfaces)
- Bordures : rgba(255,255,255,0.08)
- Accent : #F59E0B (amber)
- Typo : Syne Bold pour les titres, Inter pour le body
- Composants : shadcn/ui new-york style
- Radius : 6px

Installer : syne (google fonts)

→ vérifier : localhost:3000/login fonctionne, login redirige vers dashboard

Commit : `feat(web): add next.js app with auth flow and dashboard shell`

---

## Étape 5 — apps/workers

### apps/workers/trigger.config.ts
```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID!,
  runtime: "bun",
  logLevel: "log",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
  dirs: ["./src/jobs"],
});
```

### apps/workers/src/env.ts
Validation Zod (même pattern que apps/api).
Variables requises : DATABASE_URL, TRIGGER_SECRET_KEY, TRIGGER_PROJECT_ID.

### apps/workers/src/jobs/hello-world.job.ts
```typescript
import { task } from "@trigger.dev/sdk/v3";

export const helloWorldJob = task({
  id: "hello-world",
  async run(payload: { message: string }, { ctx }) {
    ctx.log("Hello from Outrival workers!", { message: payload.message });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    ctx.log("Job completed successfully");
    return { ok: true, echo: payload.message };
  },
});
```

→ vérifier : `pnpm trigger:dev` lance le runner
→ vérifier : déclencher le job depuis le dashboard Trigger.dev cloud

Commit : `feat(workers): add trigger.dev v3 config with hello-world job`

---

## Étape 6 — Variables d'environnement

Créer `.env.local` à la racine (gitignore) avec les vraies valeurs pour :
- DATABASE_URL (Railway PostgreSQL)
- BETTER_AUTH_SECRET (générer : openssl rand -base64 32)
- BETTER_AUTH_URL=http://localhost:3001
- NEXT_PUBLIC_API_URL=http://localhost:3001
- TRIGGER_SECRET_KEY (depuis dashboard Trigger.dev)
- TRIGGER_PROJECT_ID (depuis dashboard Trigger.dev)
- NODE_ENV=development

Vérifier que les apps démarrent sans erreur de validation env.

Commit : `chore: add env validation — do not commit .env.local`

---

## Étape 7 — Vérification finale

```bash
pnpm build      # 0 erreurs dans tous les packages
pnpm typecheck  # 0 erreurs
pnpm dev        # web :3000, api :3001, workers connecté
```

Test manuel end-to-end :
1. Aller sur http://localhost:3000/register
2. Créer un compte
3. Vérifier la session
4. Voir le dashboard
5. Logout → redirect /login

---

## Étape 8 — Mettre à jour les fichiers de planning

Mettre à jour task_plan.md :
- Phase 1 Foundation → complete ✓
- Phase 2 Scraping Core → in_progress (prochaine)

Mettre à jour findings.md avec :
- Particularités Better Auth découvertes
- Toute décision technique prise durant la phase

Mettre à jour progress.md avec le log de session.
</task>

<constraints>
- Ne pas implémenter de logique de scraping
- Ne pas configurer Stripe, Resend, ClickHouse, R2 cette phase
- Ne pas créer d'UI complexe — juste le shell navigation avec pages vides
- Le schéma DB est extensible mais sans colonnes spéculatives
- Ne pas toucher aux fichiers .claude/, CLAUDE.md, docs/
- Garder les pages dashboard vides (placeholder uniquement)
- Un seul commit par étape numérotée — ne pas tout committer en un bloc
- Si une étape échoue, s'arrêter et expliquer avant de continuer
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/skills/trigger-jobs/SKILL.md
@packages/db/CLAUDE.md
@apps/api/CLAUDE.md
@apps/web/CLAUDE.md
@apps/workers/CLAUDE.md
</references>

<verification>
La phase est terminée quand TOUS ces checks passent :

✓ pnpm build → 0 erreurs
✓ pnpm typecheck → 0 erreurs
✓ curl http://localhost:3001/health → {"status":"ok"}
✓ localhost:3000/login → page de login visible
✓ Inscription + login + redirect dashboard fonctionne
✓ Logout fonctionne
✓ Toutes les tables existent sur Railway PostgreSQL (vérifier avec Drizzle Studio)
✓ Job hello-world visible et exécutable dans le dashboard Trigger.dev
✓ task_plan.md Phase 1 = complete
</verification>

<commit>
Commits dans l'ordre :
feat(shared): add result type, domain constants
feat(db): add drizzle schema with all core entities
feat(api): add hono server with better-auth and health endpoint
feat(web): add next.js app with auth flow and dashboard shell
feat(workers): add trigger.dev v3 config with hello-world job
chore: add env validation — do not commit .env.local
</commit>