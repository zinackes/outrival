"use client";

import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

// Windowed page list: always first + last, current ±1, ellipsis for the gaps.
// e.g. window(5, 12) → [1, "ellipsis", 4, 5, 6, "ellipsis", 12]. Small counts
// (≤7) render every page, no ellipsis.
function pageWindow(current: number, count: number): (number | "ellipsis")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const wanted = new Set([1, count, current, current - 1, current + 1]);
  const sorted = [...wanted]
    .filter((p) => p >= 1 && p <= count)
    .sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

// Reusable bottom-of-table pagination for any server-paginated, client-state
// table (1-indexed pages). Renders a result count ("21–40 of 312") on the left
// and numbered shadcn pagination on the right. Hidden entirely when empty.
export function DataTablePagination({
  page,
  pageCount,
  onPageChange,
  total,
  pageSize,
  disabled = false,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
  disabled?: boolean;
  className?: string;
}) {
  // Nothing to show: single (or no) page and no count to report.
  if (pageCount <= 1 && !total) return null;

  const go = (p: number) => {
    const next = Math.min(Math.max(p, 1), Math.max(pageCount, 1));
    if (next !== page && !disabled) onPageChange(next);
  };

  const showCount = total != null && pageSize != null;
  const from = showCount ? (page - 1) * pageSize! + 1 : 0;
  const to = showCount ? Math.min(page * pageSize!, total!) : 0;

  return (
    <div
      className={cn(
        "flex flex-col-reverse items-center gap-3 sm:flex-row sm:justify-between",
        className,
      )}
    >
      {showCount ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {total === 0 ? "No results" : `${from}–${to} of ${total}`}
        </p>
      ) : (
        <span />
      )}

      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => go(page - 1)}
                disabled={disabled || page <= 1}
              />
            </PaginationItem>
            {pageWindow(page, pageCount).map((p, i) =>
              p === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === page}
                    onClick={() => go(p)}
                    disabled={disabled}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                onClick={() => go(page + 1)}
                disabled={disabled || page >= pageCount}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
