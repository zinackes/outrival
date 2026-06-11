import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about our custom type-scale tokens (globals.css @theme).
// Without this it mistakes `text-micro` & co. for text-color utilities, sees them
// conflict with a real `text-{color}` class (e.g. text-muted-foreground) and drops
// the size — silently falling back to the inherited font size.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "meta",
            "dense",
            "content",
            "lead",
            "title",
            "title-lg",
            "stat",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Strip scheme/www/trailing slash for compact URL display.
export function prettyUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}
