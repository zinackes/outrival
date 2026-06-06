import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Empty, mono, dateFmt } from "../_components/shell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminAuditEntry } from "@/lib/api";

export default async function AuditPage() {
  const data = await adminFetch<{ auditLog: AdminAuditEntry[] }>("/api/admin/audit-log");
  const rows = data?.auditLog ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Audit log" subtitle="Sensitive admin actions — most recent 100." />
      <Section
        title="Actions"
        info="Most recent sensitive admin actions (viewing a user, forcing a scrape, editing feedback) — who did it, when, and on which target. Append-only audit trail."
      >
        {rows.length === 0 ? (
          <Empty>No admin actions logged yet.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs text-muted-foreground">{dateFmt(a.createdAt)}</TableCell>
                  <TableCell style={mono}>{a.actorEmail}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{a.action}</Badge>
                  </TableCell>
                  <TableCell className="text-xs" style={mono}>
                    {a.targetType ? `${a.targetType}:${a.targetId?.slice(0, 8) ?? ""}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
