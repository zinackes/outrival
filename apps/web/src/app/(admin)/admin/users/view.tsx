"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Section, Empty, mono, dateFmt } from "../_components/shell";
import { api } from "@/lib/api";
import type { AdminUserRow } from "@/lib/api";

export function UsersView({ initial }: { initial: AdminUserRow[] }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      const res = await api.adminSearchUsers(q.trim());
      setRows(res.users);
    } catch {
      toast.error("Search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Users" subtitle="Search across users and orgs. Click a row to inspect." />

      <Section title={`Users (${rows.length})`}>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Input
            placeholder="Search by email, name or org…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9"
          />
          <Button type="submit" disabled={busy} className="h-9">
            Search
          </Button>
        </form>

        {rows.length === 0 ? (
          <Empty>No users match.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Org</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.userId} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/admin/users/${u.userId}`} className="hover:underline" style={mono}>
                      {u.email}
                    </Link>
                  </TableCell>
                  <TableCell>{u.orgName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{u.plan ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.role}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{dateFmt(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
