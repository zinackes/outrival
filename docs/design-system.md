# Design System — Outrival

> ⚠️ **Doc d'intention d'origine, PAS l'état du système.** La source de vérité est
> `DESIGN.md` à la racine (tokens, échelle, règles nommées, parité light/dark). Ce
> fichier a divergé sur plusieurs points depuis (accent amber → cyan/Iris, General
> Sans → Geist pour les titres). La section Typographie ci-dessous a été resynchronisée
> le 2026-07-29 ; le reste est à lire comme un document historique.

Partagé à l'origine entre Claude Design (landing + polish global) et Claude Code
(UI de l'app).

---

## 1. Positionnement & personnalité

Outrival est un outil de **veille concurrentielle** — du renseignement, pas un gadget.
L'esthétique cible : un **briefing d'intelligence premium**. Sharp, dense en données,
éditorial, sérieux. Jamais ludique, jamais corporate fade, jamais "dev-tool générique".

Adjectifs directeurs : précis · éditorial · dense · sûr de lui · calme · premium.
Références mentales : Linear (rigueur) × un dossier de renseignement.

---

## 2. Règles anti-AI-slop (NON NÉGOCIABLES)

Ces règles existent pour éviter le look "fait par IA". Les violer = échec.

INTERDIT :
- Hero en dégradé violet-bleu (le tell #1 de l'IA)
- Tout centré sur la page — privilégier l'asymétrie, l'alignement à gauche
- Une seule police partout — toujours des rôles typographiques distincts
- Orbes flottants, blobs en dégradé, formes 3D abstraites décoratives
- Illustrations génériques "tech" (personnages plats, isométrie cliché)
- Rangée de 3 cartes identiques sans vrai contenu produit
- Copy vague et superlatif ("la meilleure plateforme", "révolutionnaire")
- Stock photos

OBLIGATOIRE :
- Le produit en hero : montrer un vrai digest / feed de signals Outrival qui tourne
- Asymétrie maîtrisée (hero texte à gauche, visuel produit à droite)
- Hiérarchie typographique claire (display + body + mono avec rôles distincts)
- Vraies captures d'UI produit, pas des illustrations
- Copy spécifique : remplacer les superlatifs par des faits concrets
- Mouvement qui démontre le produit, jamais décoratif

---

## 3. Couleurs (tokens)

### Base (dark)
```
--bg            #0B0B0D   Fond principal (near-black, pas pur noir)
--surface       #131316   Cartes, panneaux
--surface-2     #1A1A1F   Surfaces élevées (dialogs, dropdowns)
--border        rgba(255,255,255,0.08)
--border-strong rgba(255,255,255,0.14)
```

### Texte
```
--text          rgba(255,255,255,0.95)
--text-muted    rgba(255,255,255,0.60)
--text-subtle   rgba(255,255,255,0.40)
```

### Accent de marque
```
--primary        #F59E0B   Amber — CTAs, highlights, data clé. PARCIMONIE.
--primary-hover  #E8920A
--primary-soft   rgba(245,158,11,0.10)    Fonds de badges/pills
--primary-border rgba(245,158,11,0.30)
```

### Sémantique sévérité (signals) — distincte de l'amber de marque
```
--critical      #FF4D4D
--high          #FF9F43
--medium        #FFC542
--low           #8A8A94
--positive      #34D399   Variations favorables (ex: review score qui monte)
```

Règle : l'amber = marque/action. La sévérité = échelle rouge→orange→jaune→slate.
Ne jamais utiliser l'amber pour signifier une sévérité.

---

## 4. Typographie (verrouillée)

### Stack (verrouillée)
```
Display    Geist Sans        (même famille que le corps — la hiérarchie vient du
                              poids 600 + tracking négatif, pas d'une police typée)
Body / UI  Geist Sans        (grotesque — texte, boutons, labels, ET LES CHIFFRES)
Machine    Geist Mono        (kbd, codes, IDs, URLs, slugs, marqueurs de diff)
Landing    Zodiak serif      (registre brand, scopé `.landing-canvas`)
```

Geist + Geist Mono (Vercel), Zodiak (Fontshare, ITF Free Font License). General Sans
a été retirée : une display typée lisait « designed ».

### Échelle (desktop)
L'échelle produit est tokenisée dans `globals.css` et documentée dans `DESIGN.md §3`
(`text-meta` 11 → `text-title-lg` 34, KPI `text-stat` 44) — jamais de `text-[Npx]`.
Les steps display 26→76px existent pour la landing (registre brand) seulement.

Règles :
- Geist Sans partout : titres (poids + tracking), corps, boutons, labels
- **Les chiffres sont en Geist Sans + `tabular-nums`** — prix, scores d'overlap, dates,
  compteurs, KPI. C'est l'utilitaire qui aligne la colonne, pas la police ; le mono
  n'ajoutait qu'une 2e texture à côté de la prose (`DESIGN.md`, Numbers-Are-Sans Rule)
- Geist Mono seulement pour ce qui se lit glyphe par glyphe, où un caractère lu de
  travers change le sens : `kbd`, backup codes / secret TOTP, IDs, URLs / hostnames /
  slugs, noms de header, marqueurs `+`/`-` d'un diff (Machine-Truth Rule)
- Tracking négatif sur les grands titres (-0.02 à -0.025em) pour la densité
- Une seule H1 par page

---

## 5. Espacement & grille

Échelle 4px : `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128`

```
--radius        6px    Standard (cartes, boutons, inputs)
--radius-sm     4px    Badges, pills
--radius-lg     10px   Grands panneaux, modals
```

- Pas d'ombres portées lourdes — surfaces plates différenciées par --surface et --border
- Ombre subtile autorisée uniquement sur les éléments flottants (dropdowns) :
  `0 8px 24px rgba(0,0,0,0.4)`
- Grille de contenu : max-width 1200px, gouttières 24px
- Layout asymétrique privilégié (hero 55/45, jamais 50/50 centré)

---

## 6. Layout & sections (landing)

Ordre et intention de chaque section :

1. **Navbar** — sticky, fond blur dark. Logo (Out blanc + rival amber). 1 CTA primaire.
2. **Hero** — asymétrique. Gauche : headline (General Sans), sous-headline factuelle,
   1 CTA primaire first-person + 1 ghost. Droite : VRAI digest/feed Outrival animé.
   Doit passer le test des 5 secondes.
3. **Logos / preuve sociale** — barre discrète grayscale.
4. **Problème → solution** — éditorial, pas 3 cartes génériques. Raconter la douleur
   (veille manuelle, toujours en retard) avec de vrais exemples.
5. **Comment ça marche** — 3 étapes, layout alterné gauche/droite, chaque étape
   illustrée par un VRAI bout d'UI (URL → concurrents trouvés → digest).
6. **Features (bento)** — grille disciplinée : 5-9 cellules, le bloc le plus important
   en haut à gauche. Chaque cellule montre du vrai produit.
7. **Aperçu digest** — la section phare. Un vrai digest hebdo affiché en grand.
8. **Pricing** — 3 tiers (jamais 4+). Le tier Pro mis en avant.
9. **CTA final** — une seule action, répétée.
10. **Footer** — sobre, "Made in Paris".

Règle CTA : UN objectif primaire, répété 2-3 fois (hero, après features, fin).
Wording first-person : "Commencer gratuitement" / "Lancer ma veille".

---

## 7. Composants (app)

- Base : shadcn/ui new-york, radius 6px, thémé dark via les tokens ci-dessus
- Icônes : Phosphor (`@phosphor-icons/react/ssr`) UNIQUEMENT, jamais d'emoji comme
  élément d'UI. Glyphes remplis : le poids se règle via `weight` (défaut `regular`,
  `bold` sous 14px), jamais via `strokeWidth`. Taille toujours explicite (`size={N}`
  ou une classe `size-*`) — le défaut Phosphor est `1em`, pas 24px
- Badges sévérité : pill, fond --{severity}-soft, texte --{severity}
- Boutons : primaire amber (texte sombre), secondaire ghost (bordure --border)
- Graphiques : recharts thémés dark + amber, grille discrète, axes en sans
- Tables de données : denses, chiffres en sans + `tabular-nums`, lignes séparées
  par --border
- États vides : courts, avec une action claire (jamais de gros vide décoratif)
- Pas de badge de statut "en ligne/connecté" dans les headers (anti-pattern)

---

## 8. Mouvement

- But unique : démontrer le produit. Ex : un signal qui apparaît dans le feed,
  un prix qui s'anime sur une timeline, un compteur de concurrents qui s'incrémente.
- Transitions sobres : 150-250ms, ease-out. Fade-up léger sur les sections au scroll.
- INTERDIT : parallaxe gratuite, éléments qui bougent en continu, animations qui
  retardent la lecture.
- Toujours respecter `prefers-reduced-motion`.

---

## 9. Voix & copy

- Direct, sharp, sûr de soi. Jamais corporate.
- Spécifique > superlatif. Remplacer "surveillance puissante" par
  "Sachez la seconde où ils changent leur prix".
- Parler du résultat, pas de la feature.
- CTA en first-person : "Lancer ma veille gratuitement".
- FR-first (marché cible), copy soigné main — ne jamais laisser l'IA écrire le copy final brut.

---

## 10. Accessibilité

- Contraste AA minimum sur tout le texte (near-black + texte 0.95 passe largement)
- Cibles tactiles ≥ 44px
- Focus visibles (anneau amber 2px)
- Navigation clavier complète
- `prefers-reduced-motion` respecté
- Alt text sur toutes les images produit

---

## 11. SEO technique (implémentation Next.js)

Exigences pour la landing et les pages publiques (App Router) :

- `generateMetadata` par route + `metadataBase` défini globalement
- Métadonnées rendues côté serveur (dans le HTML initial), pas via JS
- Une seule H1 par page, hiérarchie Hn sémantique correcte
- JSON-LD (pas microdata) : Organization, SoftwareApplication, FAQPage, BreadcrumbList
  → nourrit les AI Overviews et les citations Perplexity/Google AI
- `sitemap.ts` + `robots.txt` générés par le framework
- Canonicals auto-référencés sur chaque route
- Open Graph + Twitter cards avec image OG dédiée
- `next/image` partout (dimensions explicites)
- `next/font` pour General Sans/Geist (General Sans via fichiers locaux ou Fontshare,
  Geist via `geist/font`)
- Scripts tiers chargés en non-bloquant
- Pas de titre/description dupliqués entre pages

Cibles Core Web Vitals (Google 2026) :
```
LCP  ≤ 2.5s
INP  ≤ 200ms
CLS  ≤ 0.1
```

Headers de sécurité (contribuent à la confiance de crawl) : CSP, HSTS, X-Frame-Options.

---

## 12. Comment utiliser ce fichier

- **Claude Design** (landing + polish) : ce doc est le brief. Respecter sections 2-10.
- **Claude Code** (app UI) : importer les tokens (sections 3-5) dans Tailwind config,
  suivre les composants (section 7) et l'accessibilité (section 10).
- Toute évolution de la DA se fait ICI d'abord, puis se propage.