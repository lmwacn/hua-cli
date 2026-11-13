import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { ConfigManager } from "@hua/plugin-sdk";

export interface DnsProfile { baseUrl: string; uid: number; tokenEnv?: string; tokenFile?: string }
export function validateProfile(value: unknown): DnsProfile {
  const p = value as DnsProfile;
  if (!p || typeof p.baseUrl !== "string" || !Number.isSafeInteger(p.uid) || p.uid <= 0) throw new Error("baseUrl 和正整数 uid 必填");
  const url = new URL(p.baseUrl);
  // 仅本机联调允许明文 HTTP，防止管理凭证在公网裸传。
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("远程站点必须使用 HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("站点 URL 不得包含凭证、查询或片段");
  if (p.tokenFile !== undefined && (typeof p.tokenFile !== "string" || !path.isAbsolute(p.tokenFile))) throw new Error("tokenFile 必须为绝对路径");
  if (p.tokenEnv !== undefined && (typeof p.tokenEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.tokenEnv))) throw new Error("tokenEnv 无效");
  return { baseUrl: url.href.replace(/\/$/, ""), uid: p.uid, ...(p.tokenFile ? { tokenFile: p.tokenFile } : { tokenEnv: p.tokenEnv || "HUA_DNS_TOKEN" }) };
}
export const profiles = new ConfigManager<DnsProfile>({
  name: "dns", configPath: path.join(os.homedir(), ".hua", "dns.json"),
  strictValidation: true, atomicWrites: true, validateProfile,
  isProfileEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});
export function tokenFor(p: DnsProfile): string {
  const token = (p.tokenFile ? fs.readFileSync(p.tokenFile, "utf8") : process.env[p.tokenEnv || "HUA_DNS_TOKEN"])?.trim();
  if (!token || /[\r\n]/.test(token)) throw new Error("请设置 API 密钥环境变量或 token 文件（内容仅为 apikey）");
  return token;
}
