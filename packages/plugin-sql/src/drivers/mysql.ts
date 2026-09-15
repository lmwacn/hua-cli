import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { SqlProfile } from "../profile-store";
import { SqlConnection } from "./types";

export async function connectMysql(profile: SqlProfile): Promise<SqlConnection> {
  const connection = await mysql.createConnection({
    host: profile.host,
    port: profile.port,
    user: profile.user,
    password: profile.password,
    database: profile.database,
    connectTimeout: 5000,
    rowsAsArray: true,
    ssl: profile.ssl ? { rejectUnauthorized: true, ...(profile.sslCa ? { ca: readFileSync(profile.sslCa, "utf8") } : {}) } : undefined,
  });
  return {
    async query(statement) {
      const [rows, fields] = await connection.query(statement);
      if (fields?.length) {
        return [{ columns: fields.map(field => field.name), rows: rows as unknown[][] }];
      }
      return [{ columns: [], rows: [], affectedRows: (rows as mysql.ResultSetHeader).affectedRows }];
    },
    close: () => connection.end(),
    onError(listener) {
      connection.on("error", listener);
      return () => connection.off("error", listener);
    },
  };
}
