import { Client, QueryArrayResult } from "pg";
import { readFileSync } from "node:fs";
import { SqlProfile } from "../profile-store";
import { SqlConnection } from "./types";

export async function connectPostgres(profile: SqlProfile): Promise<SqlConnection> {
  const client = new Client({
    host: profile.host,
    port: profile.port,
    user: profile.user,
    // 使用回调避免空密码触发 PGPASSWORD 或 pgpass 回退。
    password: () => profile.password ?? "",
    database: profile.database,
    connectionTimeoutMillis: 5000,
    // 不允许环境变量悄悄改变 profile 的 TLS 选择。
    ssl: profile.ssl ? { rejectUnauthorized: true, ...(profile.sslCa ? { ca: readFileSync(profile.sslCa, "utf8") } : {}) } : false,
  });
  let connectionError: Error | undefined;
  const listeners = new Set<(error: Error) => void>();
  client.on("error", (error: Error) => {
    connectionError = error;
    for (const listener of listeners) listener(error);
  });
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return {
    async query(statement) {
      if (connectionError) throw connectionError;
      const response = await client.query({ text: statement, rowMode: "array" });
      const results: QueryArrayResult[] = Array.isArray(response) ? response : [response];
      return results.map(result => ({
        columns: result.fields.map(field => field.name),
        rows: result.rows,
        affectedRows: result.rowCount ?? undefined,
        command: result.command,
      }));
    },
    close: () => client.end(),
    onError(listener) {
      listeners.add(listener);
      if (connectionError) listener(connectionError);
      return () => { listeners.delete(listener); };
    },
  };
}
