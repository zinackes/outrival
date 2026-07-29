// Where SERVER-side code reaches the API.
//
// The browser has exactly one usable address: NEXT_PUBLIC_API_URL, the public
// hostname the session cookie is scoped to. The Next server is a different caller
// with a different best answer. It runs on the same host as the API, yet sending
// its fetches to the public hostname makes every one of them leave the box, cross
// Cloudflare, and come back in through Traefik to a container one hop away. A
// dashboard render fires 8 to 14 of those (the layout gate, the shell widgets, then
// the page's seeds), so the hairpin is paid 8 to 14 times per navigation.
//
// INTERNAL_API_URL is server-only on purpose: it must never be inlined into the
// client bundle (a NEXT_PUBLIC_ name would be, and the browser cannot resolve a
// container address anyway). Unset → the public URL, i.e. exactly the previous
// behaviour, so this is inert until the deployment sets it.
//
// See docs/deployment.md for the two ways to give it a value (Coolify predefined
// network → http://<service>:3001, or the host-published port).
export function serverApiBase(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:3001"
  );
}
