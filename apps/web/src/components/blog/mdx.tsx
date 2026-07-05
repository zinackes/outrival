import type { ComponentProps, ReactElement } from "react";
import Link from "next/link";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypePrettyCode, { type Options as PrettyCodeOptions } from "rehype-pretty-code";

// Server-only MDX compile. Runs at build (per-post static generation), so shiki
// highlighting costs zero client JS. Dual theme → the token colors carry both a
// --shiki-light and --shiki-dark variable; globals.css (.prose-blog) picks the
// right one per theme. keepBackground:false leaves the <pre> surface to our tokens.
const prettyCodeOptions: PrettyCodeOptions = {
  theme: { light: "github-light", dark: "github-dark" },
  keepBackground: false,
  defaultLang: "plaintext",
};

// Internal links get client-side navigation via next/link; external links open in
// a new tab with the usual rel guard.
function Anchor({ href = "", children, ...props }: ComponentProps<"a">) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}

const components = { a: Anchor };

// Compiles a raw MDX string to a React element. Returns the element directly (not
// a component) so callers just render `{await renderMdx(source)}` — sidesteps the
// async-component-in-JSX typing entirely.
export async function renderMdx(source: string): Promise<ReactElement> {
  const { content } = await compileMDX({
    source,
    components,
    options: {
      parseFrontmatter: false,
      mdxOptions: {
        rehypePlugins: [[rehypePrettyCode, prettyCodeOptions]],
      },
    },
  });
  return content;
}
