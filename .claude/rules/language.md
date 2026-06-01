# Language — English only

Applies to the whole repo. Outrival ships in **English**, period.

## Rule

Everything user-facing, AI-facing, and produced by the product is in English:

- **Web UI** — all copy, labels, buttons, placeholders, toasts, `aria-label`s,
  empty states, error messages shown to users.
- **AI prompts** — every prompt in `packages/ai` is written in English **and**
  must instruct the model to write its output in English (insights, summaries,
  digests, battle cards, review praises/complaints, candidate reasons, etc.).
  A French prompt yields French output — don't.
- **Generated artifacts** — emails (Resend digests + alerts), in-app
  notifications, and PDFs (battle cards: `lang="en"`, `toLocaleDateString("en-US", …)`).
- **Persisted enum/data values that surface to users** — e.g. digest
  `temperature` is `low | moderate | high`, not French words.

## Already enforced by global rules

Code, identifiers, commits, and `docs/` are English per the global Mathys rules
— this file is specifically about **runtime / user-visible** language.

## When adding a feature

Any new screen, prompt, email, notification, or export is English from the
first commit. No French strings, no French dates, no French enum values.
If a prompt returns free text shown to users, add an explicit
"Write all text values in English." line to it.
