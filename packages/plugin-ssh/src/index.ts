import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Client, ClientChannel } from "ssh2";
import { definePlugin } from "@hua/plugin-sdk";
import { buildConnectConfig, execCommand, uploadFile, downloadFile, testConnection } from "./client";
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
} from "./profile-store";
import { SshProfile } from "./types";
import { startSshPanel } from "./panel";

/**
 * Git Bash (MSYS) auto-converts Unix-style paths like /root/file to
 * C:/Program Files/Git/root/file, and /tmp/file to Windows temp dir.
 * Detect and undo that conversion.
 */
function undoMsysPathConversion(p: string): string {
  // Pattern 1: /root/... -> C:/Program Files/Git/root/...
  const gitMarker = "/Git/";
  const gitIdx = p.indexOf(gitMarker);
  if (/^[A-Za-z]:/.test(p) && gitIdx !== -1) {
    return "/" + p.slice(gitIdx + gitMarker.length);
  }

  // Pattern 2: /tmp/... -> C:/Users/<user>/AppData/Local/Temp/...
  // Only undo if we're in Git Bash (MSYSTEM is set)
  if (/^[A-Za-z]:/.test(p) && process.env.MSYSTEM) {
    const tempIdx = p.indexOf("/AppData/Local/Temp/");
    if (tempIdx !== -1) {
      return "/tmp/" + p.slice(tempIdx + "/AppData/Local/Temp/".length);
    }
  }

  return p;
}

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

function readStringArrayOption(options: Record<string, unknown>, key: string): string[] {
  const value = options[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function readBooleanOption(options: Record<string, unknown>, key: string): boolean {
  return options[key] === true;
}

function readNonNegativeIntegerOption(
  options: Record<string, unknown>,
  key: string,
  defaultValue: number,
): number {
  const raw = readStringOption(options, key);
  if (!raw) {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    const flag = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    throw new Error(`Option --${flag} must be a non-negative integer.`);
  }
  return value;
}

function collectStringOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function maskPassword(password?: string): string {
  if (!password) {
    return "(empty)";
  }
  return "*".repeat(Math.max(6, Math.min(12, password.length)));
}

function formatProfile(name: string, profile: SshProfile, isDefault: boolean): string {
  const defaultTag = isDefault ? " (default)" : "";
  return `${name}${defaultTag} -> ${profile.username}@${profile.host}:${profile.port}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function makeUploadStamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function sanitizeArchiveName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "upload";
}

function joinRemotePath(dir: string, fileName: string): string {
  const trimmed = dir.trim().replace(/\/+$/g, "");
  return `${trimmed || "/"}/${fileName}`.replace(/^\/\//, "/");
}

function buildTarArgs(localDir: string, outputPath: string, excludes: string[]): string[] {
  const parentDir = path.dirname(localDir);
  const baseName = path.basename(localDir);
  const args = ["-C", parentDir];

  for (const pattern of excludes) {
    args.push("--exclude", pattern);
  }

  args.push("-czf", outputPath, baseName);
  return args;
}

function createTarArchive(localDir: string, outputPath: string, excludes: string[]): void {
  const result = spawnSync("tar", buildTarArgs(localDir, outputPath, excludes), {
    encoding: "utf-8",
    stdio: "pipe",
  });

  if (result.error) {
    throw new Error(`tar failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `tar exited with code ${result.status ?? "unknown"}`);
  }
}

function isUnsafeRemoteClearTarget(remoteDir: string): boolean {
  const normalized = remoteDir.trim().replace(/\/+$/g, "") || "/";
  return normalized === "/" || normalized === "." || normalized === "..";
}

function buildRemoteExtractCommand(
  remoteTar: string,
  remoteDir: string,
  stripComponents: number,
  clearRemote: boolean,
): string {
  const clearCommand = clearRemote
    ? `
rm -rf "$remote_dir"
`
    : "";

  return `
set -Eeuo pipefail
remote_tar=${shellQuote(remoteTar)}
remote_dir=${shellQuote(remoteDir)}
cleanup() {
  rm -f "$remote_tar"
}
trap cleanup EXIT
if [ ! -f "$remote_tar" ]; then
  echo "Remote archive not found: $remote_tar" >&2
  exit 1
fi
${clearCommand}mkdir -p "$remote_dir"
tar -C "$remote_dir" --strip-components=${stripComponents} -xzf "$remote_tar"
`.trim();
}

export const sshPlugin = definePlugin({
  name: "ssh",
  description: "SSH remote server commands",
  commands: [
    {
      name: "panel",
      description: "Start a local SSH profile management panel",
      async action(context) {
        const url = await startSshPanel();
        context.log(`在浏览器中打开 ${url}，按 Ctrl+C 关闭面板。`);
      },
    },
    {
      name: "exec",
      description: "Execute a command on a remote SSH server",
      arguments: ["<command>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const command = context.args[0] ?? "";
        if (!command) {
          throw new Error("Command is required.");
        }

        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          const result = await execCommand(profile, command);

          if (result.stdout) {
            context.log(result.stdout);
          }

          if (result.stderr) {
            context.log(result.stderr);
          }

          if (result.exitCode !== 0) {
            throw new Error(`Command exited with code ${result.exitCode}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`SSH exec failed (target: ${profile.username}@${profile.host}:${profile.port}): ${message}`);
        }
      },
    },
    {
      name: "shell",
      description: "Interactive SSH shell with connection reuse (30s idle timeout)",
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
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;
        const timeoutSec = Number.parseInt(readStringOption(context.options, "timeout") || "30", 10);
        const timeoutMs = (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 30) * 1000;

        const conn = new Client();
        await new Promise<void>((resolve, reject) => {
          conn.on("ready", () => resolve());
          conn.on("error", (err) => reject(new Error(`SSH connection failed: ${err.message}`)));
          conn.connect(buildConnectConfig(profile));
        });

        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let closed = false;

        const resetTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (closed) return;
            closed = true;
            conn.end();
            process.exit(0);
          }, timeoutMs);
        };

        const closeConn = () => {
          if (closed) return;
          closed = true;
          if (idleTimer) clearTimeout(idleTimer);
          conn.end();
        };

        const isTTY = process.stdin.isTTY;

        if (isTTY) {
          context.log(`Connected to ${profile.username}@${profile.host}:${profile.port}`);
          context.log(`Idle timeout: ${timeoutSec}s | Type 'exit' to quit`);
        }

        resetTimer();

        if (!isTTY) {
          // Piped mode: use conn.shell() so the remote shell reads stdin directly,
          // avoiding shell interpretation of special characters (quotes, parens, etc.)
          const shellStream = await new Promise<ClientChannel>(
            (resolve, reject) => {
              conn.shell((err, stream) => {
                if (err) reject(err);
                else resolve(stream);
              });
            },
          );

          shellStream.on("data", (data: Buffer) => {
            process.stdout.write(data);
          });

          shellStream.stderr.on("data", (data: Buffer) => {
            process.stderr.write(data);
          });

          const rl = readline.createInterface({
            input: process.stdin,
            terminal: false,
          });

          rl.on("line", (line: string) => {
            shellStream.write(line + "\n");
          });

          rl.on("close", () => {
            shellStream.end("exit\n");
          });

          await new Promise<void>((resolve) => {
            shellStream.on("close", () => {
              closeConn();
              resolve();
            });
            process.on("SIGINT", () => {
              closeConn();
              resolve();
            });
          });
        } else {
          // Interactive mode: use per-line conn.exec() with queue
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: "ssh> ",
            terminal: true,
          });

          rl.prompt();

          let running = false;
          let inputClosed = false;
          const queue: string[] = [];

          const tryExit = () => {
            if (inputClosed && !running && queue.length === 0) {
              closeConn();
              process.exit(0);
            }
          };

          const executeCommand = (line: string) => {
            running = true;
            resetTimer();

            conn.exec(line, (err, stream) => {
              if (err) {
                console.error(`Error: ${err.message}`);
                running = false;
                rl.prompt();
                if (queue.length > 0) {
                  executeCommand(queue.shift()!);
                } else {
                  tryExit();
                }
                return;
              }

              stream.stderr.on("data", (data: Buffer) => {
                process.stderr.write(data);
              });

              stream.on("data", (data: Buffer) => {
                process.stdout.write(data);
              });

              stream.on("close", () => {
                running = false;
                rl.prompt();
                if (queue.length > 0) {
                  executeCommand(queue.shift()!);
                } else {
                  tryExit();
                }
              });
            });
          };

          rl.on("line", (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) {
              rl.prompt();
              return;
            }

            if (["exit", "quit", "\\q"].includes(trimmed.toLowerCase())) {
              rl.close();
              return;
            }

            if (running) {
              queue.push(trimmed);
              return;
            }

            executeCommand(trimmed);
          });

          rl.on("close", () => {
            inputClosed = true;
            tryExit();
          });

          await new Promise<void>((resolve) => {
            rl.on("close", resolve);
            process.on("SIGINT", () => {
              closeConn();
              rl.close();
              resolve();
            });
          });
        }
      },
    },
    {
      name: "connect",
      description: "Test SSH connection to verify connectivity and credentials",
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          const result = await testConnection(profile);
          context.log(`Connection successful: ${profile.username}@${result.host}:${result.port}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Connection failed (${profile.username}@${profile.host}:${profile.port}): ${message}`);
        }
      },
    },
    {
      name: "upload",
      description: "Upload a local file to remote server via SFTP",
      arguments: ["<localPath>", "<remotePath>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const localPath = (context.args[0] ?? "").trim();
        const remotePath = undoMsysPathConversion((context.args[1] ?? "").trim());

        if (!localPath || !remotePath) {
          throw new Error("Usage: hua ssh upload <localPath> <remotePath>");
        }

        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          let lastPercent = -1;
          await uploadFile(profile, localPath, remotePath, (transferred, total) => {
            if (total > 0) {
              const percent = Math.floor((transferred / total) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                process.stderr.write(`\rUploading: ${formatBytes(transferred)} / ${formatBytes(total)} (${percent}%)`);
              }
            }
          });
          if (lastPercent >= 0) process.stderr.write("\n");
          context.log(`Uploaded: ${localPath} -> ${profile.host}:${remotePath}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Upload failed (target: ${profile.username}@${profile.host}:${profile.port}): ${message}`);
        }
      },
    },
    {
      name: "upload-dir",
      aliases: ["updir"],
      description: "Pack a local directory, upload it, extract it on the remote server, and remove temporary archives",
      arguments: ["<localDir>", "<remoteDir>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
        {
          flags: "--exclude <pattern>",
          description: "Exclude a tar pattern; can be specified multiple times",
          processor: collectStringOption,
        },
        {
          flags: "--remote-tmp <dir>",
          description: "Remote directory for the temporary archive (default: /tmp)",
          defaultValue: "/tmp",
        },
        {
          flags: "--strip-components <count>",
          description: "Tar strip-components value when extracting (default: 1)",
          defaultValue: 1,
        },
        {
          flags: "--clear",
          description: "Remove the remote target directory before extracting",
        },
        {
          flags: "--dry-run",
          description: "Print the planned operations without running them",
        },
      ],
      async action(context) {
        const localInput = (context.args[0] ?? "").trim();
        const remoteDir = undoMsysPathConversion((context.args[1] ?? "").trim());

        if (!localInput || !remoteDir) {
          throw new Error("Usage: hua ssh upload-dir <localDir> <remoteDir>");
        }

        const localDir = path.resolve(localInput);
        if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
          throw new Error(`Local directory not found: ${localDir}`);
        }

        const clearRemote = readBooleanOption(context.options, "clear");
        if (clearRemote && isUnsafeRemoteClearTarget(remoteDir)) {
          throw new Error(`Refusing to clear unsafe remote directory: ${remoteDir}`);
        }

        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;
        const stripComponents = readNonNegativeIntegerOption(context.options, "stripComponents", 1);
        const remoteTmpDir = undoMsysPathConversion(readStringOption(context.options, "remoteTmp") || "/tmp");
        const dryRun = readBooleanOption(context.options, "dryRun");
        const excludes = [".DS_Store", "*/.DS_Store", ...readStringArrayOption(context.options, "exclude")];
        const archiveName = `${sanitizeArchiveName(path.basename(localDir))}-${makeUploadStamp()}-${process.pid}.tar.gz`;
        const remoteTar = joinRemotePath(remoteTmpDir, archiveName);

        if (dryRun) {
          const plannedLocalTar = path.join(os.tmpdir(), archiveName);
          context.log(`Would create archive: tar ${buildTarArgs(localDir, plannedLocalTar, excludes).join(" ")}`);
          context.log(`Would upload: ${plannedLocalTar} -> ${profile.host}:${remoteTar}`);
          context.log("Would execute remote extract script:");
          context.log(buildRemoteExtractCommand(remoteTar, remoteDir, stripComponents, clearRemote));
          return;
        }

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hua-ssh-upload-"));
        const localTar = path.join(tempDir, archiveName);
        let remoteCleanupNeeded = false;

        try {
          context.log(`Packing: ${localDir}`);
          createTarArchive(localDir, localTar, excludes);
          const archiveSize = fs.statSync(localTar).size;
          context.log(`Archive created: ${localTar} (${formatBytes(archiveSize)})`);

          let lastPercent = -1;
          await uploadFile(profile, localTar, remoteTar, (transferred, total) => {
            if (total > 0) {
              const percent = Math.floor((transferred / total) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                process.stderr.write(`\rUploading: ${formatBytes(transferred)} / ${formatBytes(total)} (${percent}%)`);
              }
            }
          });
          if (lastPercent >= 0) process.stderr.write("\n");
          remoteCleanupNeeded = true;

          const result = await execCommand(
            profile,
            buildRemoteExtractCommand(remoteTar, remoteDir, stripComponents, clearRemote),
          );
          remoteCleanupNeeded = false;

          if (result.stdout) {
            context.log(result.stdout);
          }
          if (result.stderr) {
            context.log(result.stderr);
          }
          if (result.exitCode !== 0) {
            throw new Error(`Remote extract exited with code ${result.exitCode}`);
          }

          context.log(`Uploaded directory: ${localDir} -> ${profile.host}:${remoteDir}`);
        } catch (err) {
          if (remoteCleanupNeeded) {
            try {
              await execCommand(profile, `rm -f ${shellQuote(remoteTar)}`);
            } catch (cleanupErr) {
              const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
              context.error(`Warning: failed to remove remote temp archive ${remoteTar}: ${cleanupMessage}`);
            }
          }

          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Upload directory failed (target: ${profile.username}@${profile.host}:${profile.port}): ${message}`);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: "download",
      description: "Download a file from remote server via SFTP",
      arguments: ["<remotePath>", "<localPath>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const remotePath = undoMsysPathConversion((context.args[0] ?? "").trim());
        const localPath = (context.args[1] ?? "").trim();

        if (!remotePath || !localPath) {
          throw new Error("Usage: hua ssh download <remotePath> <localPath>");
        }

        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          let lastPercent = -1;
          await downloadFile(profile, remotePath, localPath, (transferred, total) => {
            if (total > 0) {
              const percent = Math.floor((transferred / total) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                process.stderr.write(`\rDownloading: ${formatBytes(transferred)} / ${formatBytes(total)} (${percent}%)`);
              }
            }
          });
          if (lastPercent >= 0) process.stderr.write("\n");
          context.log(`Downloaded: ${profile.host}:${remotePath} -> ${localPath}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Download failed (target: ${profile.username}@${profile.host}:${profile.port}): ${message}`);
        }
      },
    },
    {
      name: "list",
      parentPath: ["profile"],
      aliases: ["ls"],
      description: "List configured SSH profiles",
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
      description: "Create or update an SSH profile",
      arguments: ["<name>"],
      options: [
        { flags: "--host <host>", description: "SSH server host" },
        { flags: "--port <port>", description: "SSH server port", defaultValue: 22 },
        { flags: "--username <username>", description: "SSH username" },
        { flags: "--auth-method <method>", description: "Authentication method: password or key", defaultValue: "password" },
        { flags: "--password <password>", description: "Password (for password auth)" },
        { flags: "--private-key <path>", description: "Path to private key file (for key auth)" },
        { flags: "--passphrase <passphrase>", description: "Passphrase for private key (optional)" },
      ],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const host = readStringOption(context.options, "host");
        const username = readStringOption(context.options, "username");
        const authMethod = readStringOption(context.options, "authMethod") || "password";
        const password = readStringOption(context.options, "password");
        const privateKeyPath = readStringOption(context.options, "privateKey");
        const passphrase = readStringOption(context.options, "passphrase");
        const port = Number.parseInt(readStringOption(context.options, "port") || "22", 10);

        if (!host || !username) {
          throw new Error("Missing required options. Required: --host, --username.");
        }
        if (!Number.isInteger(port) || port <= 0) {
          throw new Error("Option --port must be a positive integer.");
        }
        if (authMethod !== "password" && authMethod !== "key") {
          throw new Error("Option --auth-method must be 'password' or 'key'.");
        }

        const profile: SshProfile = {
          host,
          port,
          username,
          authMethod: authMethod as "password" | "key",
          password: password || undefined,
          privateKeyPath: privateKeyPath || undefined,
          passphrase: passphrase || undefined,
        };

        // 检查是否存在重复配置
        const duplicate = findDuplicateProfile(profile);
        if (duplicate) {
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
      description: "Set default SSH profile",
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

        context.log(`Default SSH profile set to: ${name}`);
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
          throw new Error("No default profile set. Use `hua ssh profile add <name> ...` first.");
        }

        const profile = getProfile(targetName);
        if (!profile) {
          throw new Error(`Profile not found: ${targetName}`);
        }

        const isDefault = getDefaultProfileName() === targetName;
        context.log(formatProfile(targetName, profile, isDefault));
        context.log(`authMethod=${profile.authMethod}`);
        context.log(`password=${maskPassword(profile.password)}`);
        if (profile.privateKeyPath) {
          context.log(`privateKeyPath=${profile.privateKeyPath}`);
        }
      },
    },
    {
      name: "remove",
      parentPath: ["profile"],
      aliases: ["rm"],
      description: "Remove an SSH profile",
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
