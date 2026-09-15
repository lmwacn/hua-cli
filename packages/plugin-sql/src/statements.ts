import { SqlDriver } from "./profile-store";

/** 只识别语句边界，SQL 语义由数据库处理；字符串、注释及 dollar quote 中的分号不是边界。 */
export function splitStatements(text: string, driver: SqlDriver): {
  statements: string[]; remainder: string; incomplete: boolean;
} {
  const statements: string[] = [];
  let start = 0;
  let quote = "";
  let dollar = "";
  let blockDepth = 0;
  let lineComment = false;
  let escapedString = false;
  let hasCode = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockDepth) {
      if (c === "/" && next === "*" && driver === "postgres") { blockDepth++; i++; }
      else if (c === "*" && next === "/") { blockDepth--; i++; }
      continue;
    }
    if (dollar) {
      if (text.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ""; }
      continue;
    }
    if (quote) {
      if (c === "\\" && escapedString) { i++; continue; }
      if (c === quote) {
        if (next === quote) i++;
        else quote = "";
      }
      continue;
    }
    if ((c === "-" && next === "-" && (driver === "postgres" || !text[i + 2] || /\s/.test(text[i + 2]))) || (driver === "mysql" && c === "#")) {
      lineComment = true;
      continue;
    }
    if (c === "/" && next === "*") {
      blockDepth = 1;
      // MySQL 的可执行注释必须交给服务器，不能当作空输入丢弃。
      if (driver === "mysql" && text[i + 2] === "!") hasCode = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || (driver === "mysql" && c === "`")) {
      quote = c;
      escapedString = driver === "mysql" || (c === "'" && /[eE]/.test(text[i - 1] || "") && !/[\p{L}\p{N}_$]/u.test(text[i - 2] || ""));
      hasCode = true;
      continue;
    }
    if (c === "$" && driver === "postgres" && !/[\p{L}\p{N}_$]/u.test(text[i - 1] || "")) {
      const match = text.slice(i).match(/^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u);
      if (match) { dollar = match[0]; hasCode = true; i += dollar.length - 1; continue; }
    }
    if (c === ";") {
      if (hasCode) statements.push(text.slice(start, i + 1).trim());
      start = i + 1;
      hasCode = false;
    } else if (!/\s/.test(c)) hasCode = true;
  }
  const incomplete = !!(quote || dollar || blockDepth);
  return { statements, remainder: hasCode || incomplete ? text.slice(start) : "", incomplete };
}
