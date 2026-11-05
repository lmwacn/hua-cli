import { gmail } from "@googleapis/gmail";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const READ = "https://www.googleapis.com/auth/gmail.readonly";
const COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

type Client = { client_id: string; client_secret: string };
type Authorization = Client & { credentials: Credentials; scopes: string[] };

function profileName(value: string): string {
  if (!/^[a-z0-9][a-z0-9_.@+-]{0,127}$/i.test(value)) throw new Error("无效的 Gmail profile 名称");
  return value;
}

function tokenPath(profile: string): string {
  return join(process.env.HUA_GMAIL_HOME || join(homedir(), ".hua", "gmail"), profileName(profile), "token.json");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function load(profile: string): Authorization | undefined {
  try {
    return readJson<Authorization>(tokenPath(profile));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function save(profile: string, value: Authorization, replace: boolean): void {
  const target = tokenPath(profile);
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const temporary = mkdtempSync(join(dir, ".oauth-"));
  try {
    const file = join(temporary, "token.json");
    writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    if (replace) renameSync(file, target);
    else linkSync(file, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function importAuthorization(profile: string, source: string) {
  const legacyRoot = process.env.GMAIL_CLI_HOME || join(homedir(), ".config", "gmail-cli");
  const old = readJson<Client & {
    refresh_token?: string; token?: string; expiry?: string; scopes?: string[];
  }>(join(legacyRoot, profileName(source), "token.json"));
  if (!old.client_id || !old.client_secret || !old.refresh_token ||
      !Array.isArray(old.scopes) || !old.scopes.includes(READ)) {
    throw new Error("旧版授权缺少客户端、刷新令牌或 Gmail 只读权限");
  }
  const expiry = old.expiry ? Date.parse(old.expiry) : NaN;
  const credentials = { refresh_token: old.refresh_token,
    ...(old.token && Number.isFinite(expiry) ? { access_token: old.token, expiry_date: expiry } : {}) };
  try {
    save(profile, { client_id: old.client_id, client_secret: old.client_secret, credentials, scopes: old.scopes }, false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("目标 Gmail profile 已授权，请选择其他 profile");
    throw error;
  }
  return authStatus(profile);
}

export function authStatus(profile: string) {
  const saved = load(profile);
  return { profile, authenticated: Boolean(saved?.credentials.refresh_token), scopes: saved?.scopes ?? [] };
}

export function logout(profile: string) {
  rmSync(tokenPath(profile), { force: true });
  return { profile, loggedOut: true };
}

export async function gmailService(profile: string, write = false) {
  const saved = load(profile);
  if (!saved?.credentials.refresh_token) {
    throw new Error("尚未授权，请执行 hua gmail auth login，或用 auth import 迁移旧授权");
  }
  if (write && !saved.scopes.includes(COMPOSE)) {
    throw new Error("此 profile 是只读授权，请用 auth login 授予草稿和发信权限");
  }
  const oauth = new OAuth2Client(saved.client_id, saved.client_secret);
  oauth.setCredentials(saved.credentials);
  let token: string | null | undefined;
  try {
    ({ token } = await oauth.getAccessToken());
  } catch {
    throw new Error("无法刷新 Gmail 授权，请检查网络或重新执行 hua gmail auth login");
  }
  if (!token) throw new Error("Gmail 未返回访问令牌");
  // 每次命令先取得令牌，避免 SDK 在写入失败后刷新令牌并重放请求。
  return gmail({ version: "v1", headers: { Authorization: `Bearer ${token}` }, retry: false, timeout: 60_000 });
}

function openBrowser(url: string): void {
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => { /* 已打印链接，可手动打开。 */ });
  child.unref();
}

export async function login(profile: string, file: string | undefined, readonly: boolean, noBrowser: boolean) {
  tokenPath(profile);
  const installed = file ? readJson<{ installed?: Client }>(file).installed : load(profile);
  if (!installed?.client_id || !installed.client_secret) throw new Error("请通过 --credentials 提供 Google 桌面应用 OAuth 客户端 JSON");
  const oauth = new OAuth2Client(installed.client_id, installed.client_secret);
  const pkce = await oauth.generateCodeVerifierAsync();
  const state = randomBytes(24).toString("hex");
  const scopes = readonly ? [READ] : [READ, COMPOSE];

  await new Promise<void>((resolve, reject) => {
    let callbackStarted = false;
    let settled = false;
    let redirectUri: string;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/" || url.searchParams.get("state") !== state || callbackStarted) {
        res.writeHead(400).end("Invalid OAuth callback");
        return;
      }
      callbackStarted = true;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      try {
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Google 授权未完成");
        const { tokens } = await oauth.getToken({ code, codeVerifier: pkce.codeVerifier, redirect_uri: redirectUri });
        if (settled) return;
        const granted = tokens.scope?.split(/\s+/) ?? [];
        if (!tokens.refresh_token || !scopes.every((scope) => granted.includes(scope))) {
          throw new Error("Google 未授予所需权限或未返回刷新令牌");
        }
        save(profile, { client_id: installed.client_id, client_secret: installed.client_secret,
          credentials: tokens, scopes: granted }, true);
        res.end("Gmail 授权完成，可以关闭此页面。");
        finish();
      } catch (error) {
        res.writeHead(400).end("Gmail 授权失败，请查看终端。");
        finish(error instanceof Error && !("response" in error) ? error : new Error("Google OAuth 令牌交换失败"));
      }
    });
    const timer = setTimeout(() => {
      finish(new Error("Gmail 授权等待超时"));
      server.closeAllConnections();
    }, 180_000);

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else resolve();
    }

    server.once("error", finish);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return finish(new Error("无法启动 OAuth 本地回调"));
      redirectUri = `http://127.0.0.1:${address.port}/`;
      const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: scopes,
        state, redirect_uri: redirectUri, code_challenge: pkce.codeChallenge, code_challenge_method: CodeChallengeMethod.S256 });
      process.stderr.write(`请在浏览器完成 Google 授权：${url}\n`);
      if (!noBrowser) openBrowser(url);
    });
  });
  return authStatus(profile);
}
