export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatPutTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Date(value / 10_000).toISOString();
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const render = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
  return [render(headers), render(widths.map((width) => "-".repeat(width))), ...rows.map(render)].join("\n");
}

export function storageTypeName(type?: number): string {
  const names: Record<number, string> = { 0: "standard", 1: "infrequent", 2: "archive", 3: "deep-archive", 4: "archive-ir" };
  return type === undefined ? "-" : names[type] ?? String(type);
}
