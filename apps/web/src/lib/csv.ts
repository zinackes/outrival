function escape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv<T>(
  rows: T[],
  columns: Array<{ key: keyof T | string; label: string; map?: (row: T) => unknown }>,
): string {
  const header = columns.map((c) => escape(c.label)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((c) =>
        escape(
          c.map
            ? c.map(row)
            : (row as Record<string, unknown>)[c.key as string],
        ),
      )
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
