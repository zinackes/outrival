# Archive

Rapports datés, terminés, gardés pour la trace : ce qui a été mesuré, quand, et sur
quelle base une décision a été prise. Rien ici ne décrit l'état actuel du code, et
rien ici ne se met à jour. Une affirmation d'un fichier de ce dossier se re-vérifie
dans le code avant d'être réutilisée.

| Fichier | Date | Sujet |
|---|---|---|
| [optimization-audit-2026-06.md](optimization-audit-2026-06.md) | 2026-06 | coût et latence du chemin de scrape |
| [web-audit-2026-06-30.md](web-audit-2026-06-30.md) | 2026-06-30 | UX / a11y / perf du web (130 findings, non vérifiés) |
| [page-audit-2026-06-30.md](page-audit-2026-06-30.md) | 2026-06-30 | inventaire page par page, garder / promouvoir / couper |
| [site-audit-2026-07-02.md](site-audit-2026-07-02.md) | 2026-07-02 | crawl du site, baseline = web-audit |
| [scraper-audit-2026-07.md](scraper-audit-2026-07.md) | 2026-07 | couverture et qualité des extracteurs |
| [scraping-reliability-audit-2026-07.md](scraping-reliability-audit-2026-07.md) | 2026-07 | taux d'échec de la cascade de collecte |
| [ai-consumption-audit-2026-08.md](ai-consumption-audit-2026-08.md) | 2026-08 | consommation du pool IA par tâche |

Les audits plus récents vivent sous `docs/audits/<date>/`, avec leur `REPORT.md` et
sa colonne de statut : ceux-là **sont** suivis, ils ne sont pas de l'archive.

**Quand déplacer un fichier ici** : il est daté dans son titre, son travail est
terminé, et plus personne ne l'édite. Les références entrantes se repointent sur
`docs/archive/` au moment du déplacement, sauf celles qui vivent dans un rapport
d'audit déjà rendu : celles-là sont un enregistrement, pas un lien à entretenir.
