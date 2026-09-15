import readline from "node:readline";
import { Readable, Writable } from "node:stream";
import { SqlConnection } from "./drivers/types";
import { SqlDriver } from "./profile-store";
import { splitStatements } from "./statements";
import { formatResults } from "./format-results";

export interface ShellOptions {
  input: Readable;
  output: Writable;
  log(message: string): void;
  error(message: string): void;
  driver: SqlDriver;
  timeoutMs: number;
  interactive: boolean;
}

export async function runSqlShell(connection: SqlConnection, options: ShellOptions): Promise<void> {
  const rl = readline.createInterface({ input: options.input, output: options.output, terminal: options.interactive });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let buffer = "";
  let inputClosed = false;
  let stopped = false;
  let fatal: Error | undefined;
  let closePromise: Promise<void> | undefined;
  const closeConnection = () => closePromise ??= connection.close();
  const clearIdle = () => { if (idleTimer) clearTimeout(idleTimer); };
  const interrupt = () => {
    fatal = new Error("SQL shell interrupted");
    stopped = true;
    rl.close();
    void closeConnection().catch(() => undefined);
  };
  const resetIdle = () => {
    clearIdle();
    if (inputClosed || stopped) return;
    idleTimer = setTimeout(() => {
      stopped = true;
      if (buffer.trim()) fatal = new Error("SQL shell idle timeout with unfinished input");
      rl.close();
    }, options.timeoutMs);
  };
  const removeErrorListener = connection.onError(error => {
    fatal = error;
    stopped = true;
    rl.close();
  });
  rl.on("close", () => { inputClosed = true; clearIdle(); });
  process.on("SIGINT", interrupt);
  rl.on("SIGINT", interrupt);
  async function execute(statement: string) {
    try {
      options.log(formatResults(await connection.query(statement)));
    } catch (error) {
      if (!options.interactive || stopped) throw error;
      options.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    resetIdle();
    if (options.interactive) { rl.setPrompt("sql> "); rl.prompt(); }
    // 串行消费输入，EOF/exit 必须等待此前的查询结束，事务语句不能并发执行。
    for await (const line of rl) {
      clearIdle();
      if (stopped) break;
      if (!buffer.trim() && /^(exit|quit|\\q);*$/i.test(line.trim())) { stopped = true; break; }
      buffer += `${line}\n`;
      const parsed = splitStatements(buffer, options.driver);
      buffer = parsed.remainder;
      for (const statement of parsed.statements) {
        if (stopped) break;
        await execute(statement);
      }
      if (options.interactive && !inputClosed && !stopped) {
        rl.setPrompt(buffer.trim() ? "  -> " : "sql> ");
        rl.prompt();
      }
      resetIdle();
    }
    if (fatal) throw fatal;
    if (!stopped && buffer.trim()) {
      const parsed = splitStatements(buffer, options.driver);
      if (parsed.incomplete) throw new Error("Incomplete SQL input: unclosed quote or comment");
      await execute(buffer);
    }
  } finally {
    clearIdle();
    process.off("SIGINT", interrupt);
    rl.close();
    options.input.pause();
    try { await closeConnection(); }
    finally { removeErrorListener(); }
  }
}
