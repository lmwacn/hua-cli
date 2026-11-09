import { randomBytes } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { testConnection } from "./client";
import { renderPanel } from "./panel-page";
import { listProfiles, removeProfile, savePanelProfile, setDefaultProfile } from "./profile-store";
import { SshProfile } from "./types";

class PanelError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readInput(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16_384) {
      request.resume();
      throw new PanelError(413, "提交内容过长。");
    }
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (input && typeof input === "object" && !Array.isArray(input)) return input;
  } catch {
    // 将 JSON 解析错误转换为表单提示。
  }
  throw new PanelError(400, "提交内容无效。");
}

function field(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function buildProfile(input: Record<string, unknown>, previous?: SshProfile): SshProfile {
  const host = field(input, "host").trim();
  const username = field(input, "username").trim();
  const port = input.port;
  const authMethod = input.authMethod;
  if (!host || !username) throw new PanelError(400, "请填写主机和用户名。");
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PanelError(400, "端口须为 1 到 65535 的整数。");
  }

  if (authMethod === "password") {
    const password = field(input, "password") || previous?.password;
    return { host, port, username, authMethod, password };
  }
  if (authMethod === "key") {
    const privateKeyPath = field(input, "privateKeyPath").trim();
    if (!privateKeyPath) throw new PanelError(400, "请填写私钥路径。");
    const passphrase = input.clearPassphrase === true
      ? undefined
      : field(input, "passphrase") || previous?.passphrase;
    return { host, port, username, authMethod, privateKeyPath, passphrase };
  }
  throw new PanelError(400, "请选择认证方式。");
}

function publicProfiles() {
  return listProfiles().map(({ name, isDefault, profile }) => ({
    name,
    isDefault,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authMethod: profile.authMethod,
    privateKeyPath: profile.privateKeyPath,
    hasPassword: Boolean(profile.password),
    hasPassphrase: Boolean(profile.passphrase),
  }));
}

async function handleAction(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const input = await readInput(request);
  const name = field(input, "name");
  const originalName = typeof input.originalName === "string" ? input.originalName : undefined;
  const existingName = request.url === "/api/save" ? originalName : name;
  const existing = existingName === undefined
    ? undefined
    : listProfiles().find((item) => item.name === existingName)?.profile;

  if (existingName !== undefined && !existing) {
    throw new PanelError(404, "配置已不存在，请刷新列表。");
  }

  switch (request.url) {
    case "/api/save": {
      const newName = name.trim();
      if (!newName || newName === "__proto__") throw new PanelError(400, "请输入有效的配置名称。");
      const result = savePanelProfile(newName, buildProfile(input, existing), originalName);
      if (result === "exists") throw new PanelError(409, "该名称已存在。");
      if (result === "missing") throw new PanelError(404, "配置已不存在，请刷新列表。");
      break;
    }
    case "/api/default":
      if (!setDefaultProfile(name)) throw new PanelError(404, "配置已不存在，请刷新列表。");
      break;
    case "/api/remove":
      if (!removeProfile(name)) throw new PanelError(404, "配置已不存在，请刷新列表。");
      break;
    case "/api/test": {
      const start = performance.now();
      try {
        await testConnection(existing!);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PanelError(502, message);
      }
      sendJson(response, 200, { elapsedMs: Math.round(performance.now() - start) });
      return;
    }
    default:
      throw new PanelError(404, "操作不存在。");
  }
  sendJson(response, 200, publicProfiles());
}

export async function startSshPanel(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(16).toString("base64");
  let host: string;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");

    // 同时检查 Host 和会话令牌，避免其他网站通过本地端口访问配置。
    if (request.headers.host !== host) {
      sendJson(response, 403, { error: "访问地址无效。" });
      return;
    }
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      });
      response.end(renderPanel(token, nonce));
      return;
    }

    if (request.headers["x-hua-panel"] !== token ||
        (request.headers.origin && request.headers.origin !== `http://${host}`)) {
      sendJson(response, 403, { error: "面板会话无效。" });
      return;
    }

    try {
      if (request.method === "GET" && request.url === "/api/profiles") {
        sendJson(response, 200, publicProfiles());
      } else if (request.method === "POST" && request.headers["content-type"] === "application/json") {
        await handleAction(request, response);
      } else {
        sendJson(response, 404, { error: "操作不存在。" });
      }
    } catch (error) {
      if (error instanceof PanelError) {
        sendJson(response, error.status, { error: error.message });
      } else {
        sendJson(response, 500, { error: "无法读取或保存 SSH 配置，请检查 ~/.hua/ssh.json。" });
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("无法获取 SSH 面板地址。"));
        return;
      }
      host = `127.0.0.1:${address.port}`;
      resolve(`http://${host}/`);
    });
  });
}
