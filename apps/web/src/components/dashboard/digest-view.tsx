import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon, FunnelSimpleIcon } from "@/components/icons";
import { CatText } from "./cat-pill";
import { MoverName } from "./digest-parts";
import {
  URGENCY_META,
  digestGroups,
  digestHeadline,
  digestSupportingPoints,
  isQuietDigest,
  quietSentence,
} from "@/lib/digest-shape";
import { storySummary } from "@outrival/shared";
import type {
  CompetitorStory,
  DigestContent,
  DigestSection as DigestSectionData,
  DigestSectionLink,
} from "@/lib/api";

/**
 * The body of a brief: the week's verdict, then the moves in decision order, then
 * the two blocks the reader used to throw away (sector trends, watched questions).
 *
 * Shared by the in-app reader (/dashboard/digests/[id]) and the public sample page
 * (/sample), so a visitor reads exactly what a client receives. Pure: no hooks, no
 * fetching, so it renders inside a server component.
 *
 * `links` is positional against `content.sections` and entirely optional — without
 * it every move renders as plain text, which is what the public page wants.
 */
export function DigestView({
  content,
  links,
  // The reader promotes the verdict into its masthead, so it asks for the body
  // alone. Anywhere else (the sample page) the brief has to carry its own lead.
  lead = true,
}: {
  content: DigestContent;
  links?: DigestSectionLink[];
  lead?: boolean;
}) {
  const groups = digestGroups(content);
  const sections = content.sections ?? [];
  const trends = content.sectoralTrends ?? [];
  const questions = content.watchedQuestions ?? [];
  const stories = content.competitorStories ?? [];
  const headline = digestHeadline(content);
  const points = digestSupportingPoints(content);

  if (isQuietDigest(content)) {
    return <QuietBody content={content} />;
  }

  return (
    <div className="flex flex-col gap-8">
      {lead && (headline || points.length > 0) && (
        <div className="flex flex-col gap-4">
          {headline && (
            <p className="max-w-[26ch] text-xl font-semibold leading-snug tracking-tight text-balance">
              {headline}
            </p>
          )}
          {points.length > 0 && <SupportingPoints points={points} />}
        </div>
      )}

      {groups.map((group) => {
        const meta = URGENCY_META[group.urgency];
        return (
          <section key={group.urgency} className="flex flex-col">
            <div className="flex items-center gap-2.5 border-b border-border pb-2">
              <span aria-hidden className={`h-3.5 w-[3px] rounded-[1px] ${meta.swatch}`} />
              <h3 className="text-content font-semibold tracking-tight">{meta.label}</h3>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {group.items.length}
              </span>
            </div>
            {group.items.map((section) => {
              const index = sections.indexOf(section);
              return (
                <Move
                  key={index === -1 ? `${section.competitor}-${section.insight}` : index}
                  section={section}
                  link={index === -1 ? undefined : links?.[index]}
                />
              );
            })}
          </section>
        );
      })}

      {trends.length > 0 && (
        <Band title="Sector trends" sub="Across everything we watch">
          {trends.map((t, i) => (
            <div key={i} className="border-b border-border p-4 last:border-b-0 sm:px-5">
              <h4 className="m-0 text-content font-medium tracking-tight">{t.title}</h4>
              <p className="m-0 mt-1.5 max-w-[68ch] text-content leading-relaxed text-muted-foreground">
                {t.insight}
              </p>
            </div>
          ))}
        </Band>
      )}

      {questions.length > 0 && (
        <Band
          title="Your watched questions"
          sub={`${questions.length} answer${questions.length === 1 ? "" : "s"} moved`}
        >
          {questions.map((q, i) => (
            <div key={i} className="border-b border-border p-4 last:border-b-0 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="m-0 text-content font-medium tracking-tight">{q.question}</h4>
                <span className="shrink-0 text-xs text-high">changed</span>
              </div>
              <p className="m-0 mt-1.5 max-w-[68ch] text-content leading-relaxed text-muted-foreground">
                {q.changeSummary}
              </p>
            </div>
          ))}
        </Band>
      )}

      <MemoryBand stories={stories} omitted={content.competitorStoriesOmitted ?? 0} />
    </div>
  );
}

/**
 * "What you know now" — the accumulated memory (OUT-172).
 *
 * Every other block of a brief covers seven days and is worth nothing next Monday.
 * This one is the same competitors read over the whole watch: dated facts, oldest
 * first, so the trajectory is visible rather than implied. Nothing here is newly
 * written — each line is the plain-language before/after the classifier recorded at
 * the time, replayed. Renders nothing when no competitor has enough history yet.
 */
export function MemoryBand({
  stories,
  omitted,
}: {
  stories: CompetitorStory[];
  omitted: number;
}) {
  if (stories.length === 0) return null;
  return (
    <Band
      title="What you know now"
      sub={`${stories.length} competitor${stories.length === 1 ? "" : "s"}`}
    >
      {stories.map((story) => (
        <div
          key={story.competitorId}
          className="border-b border-border p-4 last:border-b-0 sm:px-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h4 className="m-0 text-content font-medium tracking-tight">
              {story.competitor}
            </h4>
            <span className="text-xs tabular-nums text-muted-foreground">
              {storySummary(story)}
            </span>
          </div>
          <MemoryTimeline story={story} />
        </div>
      ))}
      {omitted > 0 && (
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
          +{omitted} more competitor{omitted === 1 ? "" : "s"} with a history on file
        </div>
      )}
    </Band>
  );
}

/**
 * One competitor's dated facts, oldest first. The rail on the left is what makes it
 * read as a trajectory rather than as three unrelated rows; the age leads each line
 * because "when" is the column a reader scans for.
 */
export function MemoryTimeline({ story }: { story: CompetitorStory }) {
  return (
    <ol className="m-0 mt-3 flex list-none flex-col gap-3 border-l border-border p-0 pl-3.5">
      {story.facts.map((fact, i) => (
        <li key={`${fact.at}-${i}`} className="relative flex flex-col gap-1">
          <span
            aria-hidden
            className="absolute -left-[18px] top-1.5 size-1.5 rounded-full bg-border-strong"
          />
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="tabular-nums">{fact.ago}</span>
            <CatText category={fact.category} />
          </span>
          <span className="max-w-[68ch] text-content leading-relaxed">
            {fact.before ? (
              <>
                <span className="text-muted-foreground">{fact.before}</span>
                <ArrowRightIcon
                  size={14}
                  aria-hidden
                  className="mx-1.5 inline align-[-2px] text-muted-foreground"
                />
                {fact.after}
              </>
            ) : (
              fact.after
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SupportingPoints({ points }: { points: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {points.map((p, i) => (
        <li key={i} className="flex gap-2.5 text-content leading-relaxed text-muted-foreground">
          <span aria-hidden className="mt-2.5 size-1 shrink-0 rounded-full bg-border-strong" />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One competitor move. The finding leads, the consequence follows, and the exits sit
 * underneath: reading a brief should end somewhere other than the end of the page.
 */
function Move({
  section,
  link,
}: {
  section: DigestSectionData;
  link?: DigestSectionLink;
}) {
  const competitorHref = link?.competitorId
    ? `/dashboard/competitors/${link.competitorId}`
    : null;
  const signalHref = link?.signalId ? `/dashboard/signals?focus=${link.signalId}` : null;

  return (
    <article className="group border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-dense">
        <MoverName
          name={section.competitor}
          color={link?.competitorColor ?? null}
          href={competitorHref}
        />
        {section.category && <CatText category={section.category} />}
      </div>

      <p className="m-0 mt-2 max-w-[72ch] text-content leading-relaxed">{section.insight}</p>

      {section.so_what && (
        <p className="m-0 mt-2 flex max-w-[72ch] gap-2.5 text-content leading-relaxed text-muted-foreground">
          <ArrowRightIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>{section.so_what}</span>
        </p>
      )}

      {(competitorHref || signalHref) && (
        <div className="mt-2.5 flex flex-wrap gap-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {competitorHref && (
            <Link
              href={competitorHref}
              className="inline-flex items-center gap-1.5 text-dense text-link hover:underline underline-offset-2"
            >
              <ArrowUpRightIcon size={14} aria-hidden />
              Open {section.competitor}
            </Link>
          )}
          {signalHref && (
            <Link
              href={signalHref}
              className="inline-flex items-center gap-1.5 text-dense text-link hover:underline underline-offset-2"
            >
              <FunnelSimpleIcon size={14} aria-hidden />
              See the signal
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

function Band({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
        <h3 className="text-content font-semibold tracking-tight">{title}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{sub}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * A week Outrival watched and found nothing in. It used to render as an empty page,
 * which reads as a broken product rather than as a calm market.
 */
function QuietBody({ content }: { content: DigestContent }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="m-0 max-w-[46ch] text-lg font-medium leading-snug tracking-tight text-balance">
          {quietSentence(content)}
        </p>
        <p className="m-0 mt-2.5 max-w-[54ch] text-content leading-relaxed text-muted-foreground">
          Nothing your competitors did this period was worth interrupting you for. The
          watch continues, and the next brief lands on schedule.
        </p>
      </div>

      {/* A calm period is the one that reads as "is this even running?", so it is the
          one that most needs everything that did happen next to it. */}
      <MemoryBand
        stories={content.competitorStories ?? []}
        omitted={content.competitorStoriesOmitted ?? 0}
      />
    </div>
  );
}
