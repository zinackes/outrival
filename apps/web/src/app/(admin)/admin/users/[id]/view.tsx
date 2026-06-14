"use client";

import Link from "next/link";
import { ArrowLeft, Shield, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Section, Empty, StatusPill, mono, dateFmt } from "../../_components/shell";
import { forceScrape } from "../../_components/actions";
import { ManageAccount } from "./manage-account";
import type { AdminUserDetail } from "@/lib/api";

export function UserDetailView({ detail }: { detail: AdminUserDetail }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PageHeader title={detail.user.email} subtitle={detail.user.name ?? undefined} />
          {detail.user.suspendedAt ? <Badge variant="destructive">Suspended</Badge> : null}
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/users">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Users
          </Link>
        </Button>
      </div>

      <ManageAccount detail={detail} />

      <Section
        title="Account"
        info="Core account and organisation details for this user: role, org, plan and billing period, and signup date."
      >
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <span className="text-xs text-muted-foreground">Role</span>
            <p style={mono}>{detail.user.role}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Org</span>
            <p>{detail.org?.name ?? "—"}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Plan</span>
            <p>
              <Badge variant="outline">{detail.org?.plan ?? "—"}</Badge>
              {detail.org?.planPeriod ? (
                <span className="ml-1 text-xs text-muted-foreground">{detail.org.planPeriod}</span>
              ) : null}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Joined</span>
            <p className="text-xs text-muted-foreground">{dateFmt(detail.user.createdAt)}</p>
          </div>
        </div>
      </Section>

      <Section
        title={`Competitors & monitors (${detail.competitors.length})`}
        info="Competitors this org tracks and the monitors configured on each — the sources being scraped and their state."
      >
        {detail.competitors.length === 0 ? (
          <Empty>No competitors.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {detail.competitors.map((comp) => (
              <div key={comp.id} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="font-medium">{comp.name}</span>
                  {comp.type === "self" ? <Badge variant="outline">self</Badge> : null}
                  {comp.url ? (
                    <span className="truncate text-xs text-muted-foreground" style={mono}>
                      {comp.url}
                    </span>
                  ) : null}
                </div>
                {comp.monitors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No monitors.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Last run</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comp.monitors.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell style={mono}>
                            <span className="inline-flex items-center gap-1">
                              {m.sourceType}
                              {m.requiresLevel != null && m.requiresLevel >= 2 && (
                                <>
                                  <Shield className="size-3" />L{m.requiresLevel}
                                </>
                              )}
                              {m.markedUnscrapable && <AlertTriangle className="size-3" />}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {dateFmt(m.lastRunAt)}
                          </TableCell>
                          <TableCell>
                            <StatusPill
                              status={m.lastFailedAt ? "failed" : m.isActive ? "success" : "paused"}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => forceScrape(m.id)}>
                              Force scrape
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
