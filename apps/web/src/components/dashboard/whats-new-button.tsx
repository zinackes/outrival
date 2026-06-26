"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LATEST_WHATS_NEW_DATE, WHATS_NEW_SEEN_KEY } from "@/lib/whats-new";

export function WhatsNewButton() {
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(WHATS_NEW_SEEN_KEY);
      setUnseen(!seen || seen < LATEST_WHATS_NEW_DATE);
    } catch {
      /* localStorage blocked — leave the dot off */
    }
  }, []);

  function markSeen() {
    try {
      localStorage.setItem(WHATS_NEW_SEEN_KEY, LATEST_WHATS_NEW_DATE);
    } catch {
      /* ignore */
    }
    setUnseen(false);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          aria-label="What's new"
          onClick={markSeen}
          className="relative"
        >
          <Link href="/dashboard/whats-new">
            <Megaphone size={14} />
            {unseen && (
              <span
                className="bg-primary absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                aria-hidden
              />
            )}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>What&apos;s new</TooltipContent>
    </Tooltip>
  );
}
