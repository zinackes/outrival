"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AdminNav } from "./admin-nav";

// Mobile-only entry point to the admin nav (the desktop <aside> is hidden < md).
export function AdminMobileNav() {
  return (
    <div className="mb-4 md:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <Menu className="size-4" />
            Menu
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 overflow-y-auto p-4">
          <SheetTitle className="mb-2 flex items-center gap-2">
            Outrival
            <span className="rounded bg-secondary px-1.5 py-0.5 text-meta uppercase tracking-wide text-muted-foreground">
              ops
            </span>
          </SheetTitle>
          <AdminNav />
        </SheetContent>
      </Sheet>
    </div>
  );
}
