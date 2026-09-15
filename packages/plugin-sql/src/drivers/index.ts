import { SqlProfile } from "../profile-store";
import { SqlConnection } from "./types";
import { connectMysql } from "./mysql";
import { connectPostgres } from "./postgres";

export function connectSql(profile: SqlProfile): Promise<SqlConnection> {
  switch (profile.driver) {
    case "mysql": return connectMysql(profile);
    case "postgres": return connectPostgres(profile);
    default: throw new Error(`Unsupported SQL driver: ${profile.driver}`);
  }
}
