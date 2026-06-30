// Route-level loading boundary. Without it, prev/next chevron navigation to this
// dynamic [id] segment waits for the full server response (page.tsx awaits the
// competitor fetch) before swapping — the UI freezes from the moment you click.
// A loading.tsx makes the transition instant and enables partial prefetching.
// Reuses the in-view skeleton so route + client loading states are identical.
export { default } from "./detail-skeleton";
