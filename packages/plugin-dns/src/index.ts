import fs from "node:fs";
import path from "node:path";
import { definePlugin, HuaCommand, CommandContext } from "@hua/plugin-sdk";
import { profiles, validateProfile } from "./profile-store";
import { request, redact } from "./client";
import { findTasks, ensureTask } from "./deploy";

function deployCall(c: CommandContext) {
  const resolved = profiles.resolveProfile(c.options.profile as string | undefined);
  if (!resolved) throw new Error("找不到 DNS profile，请先执行 hua dns profile add");
  return (tool: string, args: Record<string, unknown>) => request(resolved.profile, tool, args, Number(c.options.timeout || 30000));
}
function positiveId(c: CommandContext, field: string, required = false): number | undefined {
  const value = c.options[field];
  if (value === undefined && !required) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`--${field} 必须为正整数`);
  return number;
}
const deployOptions = [
  { flags: "-p, --profile <name>", description: "DNS 站点配置" },
  { flags: "--timeout <ms>", description: "单次请求超时毫秒；超时后先查询状态", defaultValue: "30000" },
  { flags: "--domain <domain>", description: "证书覆盖域名或已部署的域名" },
  { flags: "--site <site>", description: "部署站点名称（精确匹配）" },
  { flags: "--aid <id>", description: "部署账户 ID" },
  { flags: "--oid <id>", description: "证书订单 ID" },
];

export function parseData(input: string): Record<string, unknown> {
  const raw = input === "-" ? fs.readFileSync(0, "utf8") : input.startsWith("@") ? fs.readFileSync(input.slice(1), "utf8") : input;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("data 不是合法 JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("data 必须为 JSON 对象");
  return data as Record<string, unknown>;
}
const common = [
  { flags: "-p, --profile <name>", description: "DNS 站点配置" },
  { flags: "--timeout <ms>", description: "请求超时毫秒；超时后先查询状态", defaultValue: "30000" },
  { flags: "-d, --data <json>", description: "参数 JSON、@文件或 -（stdin）" },
  { flags: "--show-secrets", description: "显式输出返回的凭证或证书私钥" },
];
async function run(c: CommandContext, tool?: string, action?: string, fixed: Record<string, unknown> = {}) {
  const resolved = profiles.resolveProfile(c.options.profile as string | undefined);
  if (!resolved) throw new Error("找不到 DNS profile，请先执行 hua dns profile add");
  const data = c.options.data ? parseData(String(c.options.data)) : {};
  for (const [flag, field] of Object.entries({ id: "id", domainId: "domain_id", aid: "aid", oid: "oid", name: "name", type: "type", value: "value", recordid: "recordid", remark: "remark", ttl: "ttl", isauto: "isauto", active: "active", processid: "processid", category: "category", status: "status", line: "line", mx: "mx", weight: "weight", limit: "limit", offset: "offset", kw: "kw", domain: "domain", keytype: "keytype", keysize: "keysize", reset: "reset" })) {
    if (c.options[flag] !== undefined) data[field] = ["id", "domainId", "aid", "oid", "ttl", "mx", "weight", "limit", "offset"].includes(flag) ? Number(c.options[flag]) : c.options[flag];
  }
  for (const field of ["id", "domain_id", "aid", "oid", "ttl", "mx", "weight", "limit", "offset"]) {
    if (data[field] !== undefined && (typeof data[field] !== "number" || !Number.isSafeInteger(data[field]))) throw new Error(`${field} 必须为整数`);
  }
  for (const field of ["isauto", "active", "reset"]) {
    if (data[field] !== undefined && !new Set<unknown>([0, 1, "0", "1", true, false]).has(data[field])) throw new Error(`${field} 必须为 0 或 1`);
  }
  if (typeof c.options.domains === "string") data.domains = c.options.domains.split(",").map(s => s.trim()).filter(Boolean);
  if (c.options.config) data.config = parseData(String(c.options.config));
  Object.assign(data, fixed, action ? { action } : {});
  const result = await request(resolved.profile, tool, data, Number(c.options.timeout));
  c.log(JSON.stringify(c.options.showSecrets || !tool || tool === "list_provider_types" ? result : redact(result), null, 2));
}
const fields = [
  ["id", "资源 ID"], ["domain-id", "域名 ID"], ["aid", "账户 ID"], ["oid", "证书订单 ID"],
  ["name", "主机记录或名称"], ["type", "解析或服务商类型"], ["value", "记录值"], ["recordid", "解析记录 ID"],
  ["ttl", "TTL 秒数"], ["remark", "备注"], ["domains", "逗号分隔域名列表"],
  ["isauto", "自动续签：0 或 1"], ["active", "任务开关：0 或 1"],
  ["status", "解析或任务状态"], ["line", "解析线路 ID"], ["mx", "MX 优先级"], ["weight", "解析权重"],
  ["limit", "每页数量"], ["offset", "分页偏移"], ["kw", "搜索关键词"], ["domain", "按域名筛选"],
  ["keytype", "RSA / ECC"], ["keysize", "密钥长度"], ["reset", "执行前重置：0 或 1"],
  ["config", "部署或账户配置 JSON / @文件"], ["processid", "日志处理 ID"], ["category", "dns / cert / deploy"],
].map(([flag, description]) => ({ flags: `--${flag} <value>`, description }));
function resource(group: string[], query: string, manage: string, actions: Record<string, string>, fixed = {}): HuaCommand[] {
  return Object.entries(actions).map(([name, action]) => ({
    parentPath: group, name, description: `${name}（参数定义见 hua dns tools）`, options: [...common, ...fields],
    async action(c) { await run(c, ["list", "get", "show_log", "info", "quickinfo", "remote_list"].includes(action) ? query : manage, action, fixed); },
  }));
}
export const dnsPlugin = definePlugin({ name: "dns", description: "聚合 DNS、证书签发与证书部署任务（HTTP API）", commands: [
  { name: "tools", description: "查看当前账号可用操作及参数定义（与 MCP 共用）", options: common, async action(c) { await run(c); } },
  { name: "call", arguments: ["<tool>"], description: "调用任意已授权操作，参数通过 --data 传入", options: common, async action(c) { await run(c, c.args[0]); } },
  { name: "providers", description: "查询服务商及部署参数定义", options: [...common, ...fields], async action(c) { await run(c, "list_provider_types"); } },
  ...resource(["domain"], "domain_query", "domain_manage", { list: "list", get: "get", info: "info", remote: "remote_list", add: "add", edit: "edit", delete: "del" }),
  ...resource(["record"], "record_query", "record_manage", { list: "list", add: "add", update: "update", delete: "delete", status: "set_status" }),
  ...resource(["cert"], "cert_order_query", "cert_order_manage", { list: "list", get: "get", add: "add", edit: "edit", process: "process", auto: "set_auto", reset: "reset", delete: "del", logs: "show_log" }),
  ...resource(["deploy"], "cert_deploy_query", "cert_deploy_manage", { list: "list", add: "add", edit: "edit", process: "process", active: "set_active", reset: "reset", delete: "del", logs: "show_log" }),
  { parentPath: ["deploy"], name: "find", description: "按证书覆盖域名、账户IP或站点查找任务（多个条件取交集）", options: [...deployOptions,
    { flags: "--ip <ip>", description: "部署账户地址中的主机/IP（不做 DNS 解析）" },
  ], async action(c) {
    c.log(JSON.stringify(await findTasks(deployCall(c), { domain: c.options.domain as string | undefined, ip: c.options.ip as string | undefined,
      site: c.options.site as string | undefined, aid: positiveId(c, "aid"), oid: positiveId(c, "oid") }), null, 2));
  } },
  { parentPath: ["deploy"], name: "ensure", description: "确保宝塔网站部署任务存在，优先复用并补入站点（不立即执行部署）", options: [...deployOptions,
    { flags: "--id <id>", description: "多个候选时指定复用任务 ID" },
  ], async action(c) {
    const aid = positiveId(c, "aid", true)!, oid = positiveId(c, "oid", true)!, id = positiveId(c, "id");
    if (typeof c.options.site !== "string" || typeof c.options.domain !== "string" || !c.options.domain.trim()) throw new Error("必须指定 --site 和 --domain");
    c.log(JSON.stringify(await ensureTask(deployCall(c), { aid, oid, id, site: c.options.site, domain: c.options.domain }), null, 2));
  } },
  ...resource(["account", "dns"], "dns_account_query", "dns_account_manage", { list: "list", add: "add", edit: "edit", delete: "del" }),
  ...resource(["account", "cert"], "cert_account_query", "cert_account_manage", { list: "list", add: "add", edit: "edit", delete: "del" }, { deploy: 0 }),
  ...resource(["account", "deploy"], "cert_account_query", "cert_account_manage", { list: "list", add: "add", edit: "edit", delete: "del" }, { deploy: 1 }),
  { parentPath: ["profile"], name: "add", arguments: ["<name>"], description: "添加站点，密钥使用环境变量或文件，不保存在 profile", options: [
    { flags: "--base-url <url>", description: "站点根地址" }, { flags: "--uid <id>", description: "开启 API 权限的用户 ID" },
    { flags: "--token-env <name>", description: "API 密钥环境变量", defaultValue: "HUA_DNS_TOKEN" }, { flags: "--token-file <path>", description: "仅含 API 密钥的本地文件" },
  ], action(c) {
    const p = validateProfile({ baseUrl: c.options.baseUrl, uid: Number(c.options.uid), tokenEnv: c.options.tokenEnv, ...(c.options.tokenFile ? { tokenFile: path.resolve(String(c.options.tokenFile)) } : {}) });
    if (!c.args[0]?.trim() || ["__proto__", "constructor", "prototype"].includes(c.args[0])) throw new Error("profile 名称无效");
    profiles.addOrUpdateProfile(c.args[0], p); c.log(`已保存 DNS profile：${c.args[0]}`);
  } },
  { parentPath: ["profile"], name: "list", description: "列出站点配置", action(c) { c.log(JSON.stringify(profiles.listProfiles(), null, 2)); } },
  { parentPath: ["profile"], name: "use", arguments: ["<name>"], description: "设置默认站点", action(c) { if (!profiles.setDefaultProfile(c.args[0])) throw new Error("找不到 profile"); c.log(`默认站点：${c.args[0]}`); } },
  { parentPath: ["profile"], name: "remove", arguments: ["<name>"], description: "删除站点配置", action(c) { if (!profiles.removeProfile(c.args[0])) throw new Error("找不到 profile"); c.log(`已删除：${c.args[0]}`); } },
] });
