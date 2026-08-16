import { cn } from "@/lib/utils";

// The Outrival orbit mark. Two rasters — dark ink for light surfaces, light ink for
// dark surfaces — swapped by the theme `.dark` class on <html> (next-themes,
// attribute="class"). No JS, no hydration flash. The indigo orbit dot is identical in
// both variants, so this can't collapse to a currentColor mask; hence two images.
//
// They are CSS backgrounds rather than <img> for one reason: a `display:none` <img>
// is STILL downloaded, so the previous markup fetched both rasters on every page and
// discarded one. A background on a non-rendered element is never fetched. With the
// 96px sources below (the mark is drawn between 20 and 44px), the logo went from
// ~149KB per page load to under 4KB.
//
// /public/logo-{dark,light}.png keep the 512px source artwork; the -96 files are what
// the product serves.
export function LogoMark({
  className,
  size = 28,
  ink = false,
}: {
  className?: string;
  size?: number;
  /** Pin one variant regardless of theme — for regions whose background does
      not follow html.dark. `true` pins the dark-ink mark (the landing's
      pinned-light paper hero, where the `dark:` swap would show the white mark
      on paper); `"light"` pins the light-ink one (the landing's floating nav
      pill once it is over the dark body, inside that same pinned-light tree). */
  ink?: boolean | "light";
}) {
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {ink ? (
        <span
          className={cn(
            "block h-full w-full bg-contain bg-center bg-no-repeat",
            ink === "light"
              ? "bg-[url('/logo-light-96.png')]"
              : "bg-[url('/logo-dark-96.png')]",
          )}
        />
      ) : (
        <>
          {/* light surfaces → dark-ink mark */}
          <span className="block h-full w-full bg-[url('/logo-dark-96.png')] bg-contain bg-center bg-no-repeat dark:hidden" />
          {/* dark surfaces → light-ink mark */}
          <span className="hidden h-full w-full bg-[url('/logo-light-96.png')] bg-contain bg-center bg-no-repeat dark:block" />
        </>
      )}
    </span>
  );
}
