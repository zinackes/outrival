import type { ReactNode } from "react";

export function PageHead({
  title,
  sub,
  actions,
  icon,
  // Drop the built-in bottom margin when the head sits in a `gap`-spaced parent
  // (the section views), so spacing isn't doubled. Default keeps the margin for
  // the surfaces that rely on it (overview, competitors list).
  flush = false,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  flush?: boolean;
}) {
  return (
    <div
      className={`flex items-start md:items-center justify-between gap-4 md:gap-6 flex-wrap${
        flush ? "" : " mb-6 md:mb-8"
      }`}
    >
      <div>
        <h1
          className={`text-title md:text-title-lg font-semibold m-0${
            icon ? " flex items-center gap-2" : ""
          }`}
        >
          {icon}
          {title}
        </h1>
        {sub && (
          <div className="text-muted-foreground text-dense mt-1">{sub}</div>
        )}
      </div>
      {actions && (
        <div className="flex gap-2 items-center flex-wrap">{actions}</div>
      )}
    </div>
  );
}
