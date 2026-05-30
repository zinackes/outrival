import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DangerZonePage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight text-critical">
          Danger zone
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Irreversible actions on this workspace.
        </p>
      </header>

      <Card className="border-critical/20 px-5 py-[18px]">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="font-semibold text-sm">Delete workspace</div>
            <div className="text-muted-foreground text-[13px] mt-1">
              Permanently erases all signals, digests and battle cards. This
              action cannot be undone.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled
            className="text-destructive border-destructive/25"
          >
            Delete
          </Button>
        </div>
      </Card>
    </section>
  );
}
