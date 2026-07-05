import { cn } from "@/lib/utils";

// The Outrival orbit mark. Two rasters — dark ink for light surfaces,
// light ink for dark surfaces — swapped by the theme `.dark` class on <html>
// (next-themes, attribute="class"). No JS, no hydration flash. The indigo orbit
// dot is identical in both variants, so this can't collapse to a currentColor
// mask; hence two images. Source artwork lives in /public/logo-{dark,light}.png.
export function LogoMark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* light surfaces → dark-ink mark */}
      <img
        src="/logo-dark.png"
        alt=""
        width={size}
        height={size}
        className="block h-full w-full object-contain dark:hidden"
      />
      {/* dark surfaces → light-ink mark */}
      <img
        src="/logo-light.png"
        alt=""
        width={size}
        height={size}
        className="hidden h-full w-full object-contain dark:block"
      />
    </span>
  );
}
