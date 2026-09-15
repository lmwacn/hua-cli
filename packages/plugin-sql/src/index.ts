import { connectSql } from "./drivers";
import { formatResults } from "./format-results";
import { runSqlShell } from "./shell";
import readline from "node:readline";
import { definePlugin } from "@hua/plugin-sdk";
import {
  addOrUpdateProfile,
  findDuplicateProfile,
  getConfigPath,
  getDefaultProfileName,
  getProfile,
  listProfiles,
  removeProfile,
  resolveProfile,
  setDefaultProfile,
  SqlProfile,
  parseDriver,
  defaultPort,
} from "./profile-store";

function readStringOption(options: Record<string, unknown>, key: string): string {
  const value = options[key];
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function maskPassword(password?: string): string {
  if (!password) {
    return "(empty)";
  }
  return "*".repeat(Math.max(6, Math.min(12, password.length)));
}

function formatProfile(name: string, profile: SqlProfile, isDefault: boolean): string {
  const defaultTag = isDefault ? " (default)" : "";
  return `${name}${defaultTag} [${profile.driver}] -> ${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
}

export const sqlPlugin = definePlugin({
  name: "sql",
  description: "SQL tools and database commands",
  commands: [
    {
      name: "query",
      description: "Run a SQL query against a configured datasource",
      arguments: ["<statement>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const statement = context.args[0] ?? "";
        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SQL profile. Use `hua sql profile add <name> --host ... --user ... --database ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          const connection = await connectSql(profile);
          try {
            context.log(formatResults(await connection.query(statement)));
          } finally {
            await connection.close();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Query failed (target: ${profile.driver} ${profile.user}@${profile.host}:${profile.port}/${profile.database}): ${message}`);
        }
      },
    },
    {
      name: "shell",
      description: "Interactive SQL shell with connection reuse (30s idle timeout)",
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
        {
          flags: "-t, --timeout <seconds>",
          description: "Idle timeout in seconds (default: 30)",
          defaultValue: 30,
        },
      ],
      async action(context) {
        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SQL profile. Use `hua sql profile add <name> --host ... --user ... --database ...` first.",
          );
        }

        const { profile } = resolved;
        const timeoutSec = Number(readStringOption(context.options, "timeout") || "30");
        if (!Number.isFinite(timeoutSec) || timeoutSec <= 0 || timeoutSec * 1000 > 2147483647) {
          throw new Error("Option --timeout must be a positive number within the timer range.");
        }
        const connection = await connectSql(profile);
        if (process.stdin.isTTY) {
          context.log(`Connected to ${profile.driver} ${profile.user}@${profile.host}:${profile.port}/${profile.database}`);
          context.log(`Idle timeout: ${timeoutSec}s | Type 'exit' to quit`);
        }
        await runSqlShell(connection, {
          input: process.stdin,
          output: process.stdout,
          log: context.log,
          error: context.error,
          driver: profile.driver,
          timeoutMs: timeoutSec * 1000,
          interactive: !!process.stdin.isTTY,
        });
      },
    },
    {
      name: "list",
      parentPath: ["profile"],
      aliases: ["ls"],
      description: "List configured SQL connection profiles",
      async action(context) {
        const profiles = listProfiles();
        if (profiles.length === 0) {
          context.log(`No profiles configured yet. Config file: ${getConfigPath()}`);
          return;
        }

        context.log(`Config file: ${getConfigPath()}`);
        for (const item of profiles) {
          context.log(formatProfile(item.name, item.profile, item.isDefault));
        }
      },
    },
    {
      name: "add",
      parentPath: ["profile"],
      description: "Create or update a SQL connection profile",
      arguments: ["<name>"],
      options: [
        { flags: "--host <host>", description: "Database host" },
        { flags: "--driver <driver>", description: "Database driver: mysql or postgres (aliases: postgresql, pgsql); default mysql" },
        { flags: "--port <port>", description: "Database port (MySQL: 3306, PostgreSQL: 5432)" },
        { flags: "--ssl", description: "Enable TLS with certificate verification" },
        { flags: "--ssl-ca <path>", description: "CA certificate file (implies --ssl)" },
        { flags: "--user <user>", description: "Database user" },
        { flags: "--password <password>", description: "Database password (optional)" },
        { flags: "--database <database>", description: "Database name" },
      ],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const host = readStringOption(context.options, "host");
        const user = readStringOption(context.options, "user");
        const database = readStringOption(context.options, "database");
        const password = typeof context.options.password === "string" ? context.options.password : undefined;
        const driver = parseDriver(context.options.driver);
        const port = Number(readStringOption(context.options, "port") || defaultPort(driver));
        const sslCa = readStringOption(context.options, "sslCa") || undefined;

        if (!host || !user || !database) {
          throw new Error("Missing required options. Required: --host, --user, --database.");
        }
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error("Option --port must be an integer between 1 and 65535.");
        }

        const profile: SqlProfile = {
          driver,
          host,
          port,
          user,
          password: password || undefined,
          database,
          ssl: !!(context.options.ssl || sslCa),
          sslCa,
        };

        // 检查是否存在重复配置
        const duplicate = findDuplicateProfile(profile);
        if (duplicate && duplicate.name !== name) {
          if (!process.stdin.isTTY) {
            throw new Error(`Identical profile already exists: ${duplicate.name}. Use that profile or add from an interactive terminal.`);
          }
          context.log(`\x1b[33m已存在相同配置的 profile: "${duplicate.name}"\x1b[0m`);
          context.log(`配置内容: ${formatProfile(duplicate.name, duplicate.profile, false)}`);
          context.log("");
          context.log("请选择操作:");
          context.log("  1. 使用已有的 profile（不创建新的）");
          context.log("  2. 强制创建新 profile（即使内容相同）");
          context.log("  3. 取消操作");
          context.log("");

          const choice = await new Promise<string>((resolve) => {
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            rl.question("请输入选项 (1/2/3): ", (answer) => {
              rl.close();
              resolve(answer.trim());
            });
          });

          switch (choice) {
            case "1":
              context.log(`使用已有 profile: ${duplicate.name}`);
              return;
            case "2":
              // 继续创建
              break;
            case "3":
              context.log("操作已取消");
              return;
            default:
              context.log("无效选择，操作已取消");
              return;
          }
        }

        addOrUpdateProfile(name, profile);

        const defaultProfile = getDefaultProfileName();
        context.log(`Saved profile: ${name}`);
        context.log(formatProfile(name, profile, defaultProfile === name));
      },
    },
    {
      name: "use",
      parentPath: ["profile"],
      description: "Set default SQL profile",
      arguments: ["<name>"],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const ok = setDefaultProfile(name);
        if (!ok) {
          throw new Error(`Profile not found: ${name}`);
        }

        context.log(`Default SQL profile set to: ${name}`);
      },
    },
    {
      name: "show",
      parentPath: ["profile"],
      description: "Show profile detail by name or current default profile",
      arguments: ["[name]"],
      async action(context) {
        const inputName = (context.args[0] ?? "").trim();
        const targetName = inputName || getDefaultProfileName() || "";
        if (!targetName) {
          throw new Error("No default profile set. Use `hua sql profile add <name> ...` first.");
        }

        const profile = getProfile(targetName);
        if (!profile) {
          throw new Error(`Profile not found: ${targetName}`);
        }

        const isDefault = getDefaultProfileName() === targetName;
        context.log(formatProfile(targetName, profile, isDefault));
        context.log(`driver=${profile.driver}`);
        context.log(`ssl=${!!profile.ssl}`);
        if (profile.sslCa) context.log(`sslCa=${profile.sslCa}`);
        context.log(`password=${maskPassword(profile.password)}`);
      },
    },
    {
      name: "remove",
      parentPath: ["profile"],
      aliases: ["rm"],
      description: "Remove a SQL connection profile",
      arguments: ["<name>"],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const ok = removeProfile(name);
        if (!ok) {
          throw new Error(`Profile not found: ${name}`);
        }

        const currentDefault = getDefaultProfileName();
        context.log(`Removed profile: ${name}`);
        context.log(`Current default profile: ${currentDefault ?? "(none)"}`);
      },
    },
  ],
});
