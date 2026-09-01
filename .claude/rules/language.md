# Runtime language: English only

Tout ce qui est visible par un utilisateur ou consommé par un modèle est en
anglais : copy web (labels, toasts, empty states, `aria-label`), prompts de
`packages/ai` **et** l'instruction explicite « Write all text values in English. »
dans chaque prompt qui rend du texte libre, emails Resend, notifications in-app,
PDF (`lang="en"`, `toLocaleDateString("en-US", …)`), et les valeurs d'enum
persistées qui remontent à l'écran (`temperature` = `low | moderate | high`).

Un prompt écrit en français rend du français. Toute nouvelle vue, prompt, email ou
export est anglais dès le premier commit.

Le code, les identifiants, les commits et `docs/` sont déjà en anglais par les
règles globales : ce fichier parle du runtime.
