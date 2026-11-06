"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UseTaskHistory } from "@/hooks/use-task-history";
import { formatCount } from "@/lib/recording/format";
import {
  HISTORY_PAGE_SIZES,
  type HistoryPageSize,
  type HistoryPageWindow,
} from "@/lib/task/history";
import { cn } from "@/lib/utils";

const SIZE_ITEMS = HISTORY_PAGE_SIZES.map((size) => ({
  value: String(size),
  label: String(size),
}));

/** "11–20 of 47 jobs", or the rows' span alone while the count is unknown or disagrees. */
function spanText({ from, to, total }: HistoryPageWindow): string {
  const span = from === to ? formatCount(from) : `${formatCount(from)}–${formatCount(to)}`;
  return total === null ? span : `${span} of ${formatCount(total)} jobs`;
}

/**
 * The list's pager. Mounted above the list and again below it, one markup
 * each rather than one hidden copy: the bottom one is what a long page ends
 * on, the top one stays put while rows expand. Only the top one announces
 * the span, so a page turn is read once.
 *
 * Newest, not Last: the backend pages forward only, so the first page's
 * cursor is the only one always in hand.
 */
export function HistoryPager({
  history,
  span,
  pageSize,
  onPageSize,
  placement,
  onTurn,
}: {
  history: UseTaskHistory;
  span: HistoryPageWindow;
  pageSize: HistoryPageSize;
  onPageSize: (next: HistoryPageSize) => void;
  placement: "top" | "bottom";
  /** Called after a page turn this pager made. */
  onTurn?: () => void;
}) {
  const sizeId = React.useId();
  const paged = history.hasPrev || history.hasNext;
  const turn = (go: () => void) => () => {
    go();
    onTurn?.();
  };

  return (
    <nav
      aria-label={placement === "top" ? "History pages" : "History pages, bottom"}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <p
        className="readout text-[12px] text-muted-foreground"
        aria-live={placement === "top" ? "polite" : undefined}
      >
        {span.from > 0 && spanText(span)}
        {paged && (
          <span className="max-sm:hidden">
            {span.from > 0 && " · "}
            Page {history.page}
            {span.pageCount !== null && ` of ${span.pageCount}`}
          </span>
        )}
      </p>

      <div className="flex items-center gap-3">
        {placement === "top" && (
          <div className="flex items-center gap-1.5">
            <label htmlFor={sizeId} className="instrument-label text-muted-foreground">
              Per page
            </label>
            <Select
              items={SIZE_ITEMS}
              value={String(pageSize)}
              onValueChange={(next) => {
                if (next !== null) onPageSize(Number(next) as HistoryPageSize);
              }}
            >
              <SelectTrigger
                id={sizeId}
                size="sm"
                className="h-7 rounded-sm text-[12px] pointer-coarse:h-10"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {paged && (
          <div className="flex items-center gap-1.5">
            <PageButton
              label="Newest"
              disabled={!history.hasPrev || history.switching}
              onClick={turn(history.first)}
            >
              <ChevronsLeftIcon aria-hidden />
            </PageButton>
            <PageButton
              label="Previous"
              disabled={!history.hasPrev || history.switching}
              onClick={turn(history.prev)}
            >
              <ChevronLeftIcon aria-hidden />
            </PageButton>
            <PageButton
              label="Next"
              trailing
              disabled={!history.hasNext || history.switching}
              onClick={turn(history.next)}
            >
              <ChevronRightIcon aria-hidden />
            </PageButton>
          </div>
        )}
      </div>
    </nav>
  );
}

/** Labelled from sm up; an icon with its name for a screen reader below, so the row fits a phone. */
function PageButton({
  label,
  trailing = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  trailing?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("pointer-coarse:h-10 pointer-coarse:min-w-10", trailing && "flex-row-reverse")}
    >
      {children}
      <span className="max-sm:hidden">{label}</span>
    </Button>
  );
}
