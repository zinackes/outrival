// patch-29 — settings nav moved into the contextual sub-sidebar (Variante 1,
// rendered by DashboardShell on /dashboard/settings/*). The layout now just
// constrains the content width; each page owns its own section header.
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="max-w-[760px]">{children}</div>;
}
