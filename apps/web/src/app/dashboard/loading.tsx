// Route-loading boundary for the dashboard index (overview) — and, being the segment
// root, the prefetched shell shown on navigation to /dashboard. Points at the faithful
// overview skeleton (KPI strip + recent-signals list, same component the client in-view
// gate uses) so the skeleton→content shift is minimal. Every child route ships its own
// loading.tsx, so none inherits this overview shape.
export { default } from "./dashboard-skeleton";
