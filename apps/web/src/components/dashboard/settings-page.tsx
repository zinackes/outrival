import type { ReactNode } from "react";

/**
 * The title of a settings page.
 *
 * Every settings route used to open on an `h2` at `text-base` — 16px, the same
 * size as the body text under it — and no `h1` anywhere, so heading navigation
 * started mid-page and Security stacked three sibling `h2`s with nothing above
 * them. This owns the `h1` at the rank the rest of the dashboard already uses
 * (PageHead), and section components stopped rendering their own headers.
 *
 * Separate from PageHead rather than a prop on it: the dashboard's title sits on
 * a page that scrolls under a full-bleed workspace, this one heads a bounded
 * reading column, and the two want different bottom rhythm.
 */
export function SettingsPageHead({
  title,
  description,
  action,
  tone = "default",
}: {
  title: string;
  description?: ReactNode;
  /** Page-level metadata or a primary action — a plan badge, a quota meter. */
  action?: ReactNode;
  /** `critical` tints the title on the danger zone. */
  tone?: "default" | "critical";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1
          className={`m-0 text-title font-semibold tracking-tight ${
            tone === "critical" ? "text-critical" : ""
          }`}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-[60ch] text-dense text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A section inside a settings page.
 *
 * One heading rank for every section on every page. Before this, the same rank
 * was rendered four different ways (`text-sm font-semibold`, `text-sm
 * font-medium`, `text-dense font-semibold`, `text-base font-medium`) depending
 * on which page you were on, and descriptions dropped to `text-xs` (12px) on
 * Notifications, under the 14px prose floor globals.css sets.
 *
 * `divider` follows SectionHead's rule: drop the rule when the section's content
 * is itself a bordered box, or the box's top edge doubles it.
 */
export function SettingsSection({
  title,
  description,
  action,
  divider = true,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    // gap-3, not per-caller margins: the spacing between a section's rule and its
    // content was the thing every page had picked differently.
    <section className="flex flex-col gap-3">
      <div
        className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${
          divider ? "border-b border-border pb-2.5" : ""
        }`}
      >
        <div className="min-w-0">
          <h2 className="m-0 text-content font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-1 max-w-[64ch] text-dense text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * One setting: what it is on the left, the control on the right.
 *
 * A settings page is a list of decisions, and the label/input/hint stack it used
 * to be made a page of seventeen of them (Notifications) read as a wall. Naming
 * the shape also stops each page inventing its own spacing between a label and
 * the thing it labels.
 *
 * Wrap the label in a real `<label htmlFor>` at the call site when the control is
 * an Input — this renders the row, not the association.
 */
export function SettingRow({
  label,
  hint,
  htmlFor,
  control,
  /** Stack the control under the label — for controls too wide to sit beside it. */
  stacked = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  control: ReactNode;
  stacked?: boolean;
}) {
  const text = (
    <div className="min-w-0 flex-1">
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dense font-medium"
        >
          {label}
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dense font-medium">
          {label}
        </div>
      )}
      {hint && (
        <p className="mt-1 max-w-[52ch] text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );

  if (stacked) {
    return (
      <div className="border-b border-border py-3 last:border-b-0">
        {text}
        <div className="mt-2 flex flex-wrap items-center gap-2">{control}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2 border-b border-border py-3 last:border-b-0">
      {text}
      <div className="flex shrink-0 items-center gap-2 pt-0.5">{control}</div>
    </div>
  );
}
