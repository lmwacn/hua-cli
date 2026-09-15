import { SqlResult } from "./drivers/types";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex")}`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatResults(results: SqlResult[]): string {
  return results.map(result => {
    if (!result.columns.length) {
      return result.affectedRows === undefined
        ? `${result.command || "Query"} executed successfully`
        : `Query OK, ${result.affectedRows} row(s) affected`;
    }
    if (!result.rows.length) return "(empty result set)";
    const data = result.rows.map(row => row.map(cell));
    const widths = result.columns.map(name => name.length);
    for (const row of data) row.forEach((value, i) => { widths[i] = Math.max(widths[i], value.length); });
    const line = (row: string[]) => row.map((value, i) => value.padEnd(widths[i])).join(" | ");
    return [line(result.columns), widths.map(width => "-".repeat(width)).join("-+-"),
      ...data.map(line), `\n${result.rows.length} row(s) returned`].join("\n");
  }).join("\n\n");
}
