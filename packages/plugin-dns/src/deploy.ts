import { domainToASCII } from "node:url";

type Row = Record<string, any>;
export type Call = (tool: string, args: Record<string, unknown>) => Promise<any>;

function host(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  return domainToASCII(normalized) || normalized;
}
export function covers(pattern: string, domain: string): boolean {
  const p = host(pattern), d = host(domain);
  if (!p.startsWith("*.")) return p === d;
  const suffix = p.slice(2);
  return d.endsWith(`.${suffix}`) && d.split(".").length === suffix.split(".").length + 1;
}
function config(row: Row): Row {
  let result: unknown;
  try { result = typeof row.config === "string" ? JSON.parse(row.config) : row.config; }
  catch { throw new Error(`任务 ${row.id} 的配置格式无效`); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`任务 ${row.id} 的配置不可读取，无法判断是否可复用`);
  return result as Row;
}
function sites(row: Row): string[] {
  const c = config(row);
  return typeof c.sites === "string" ? c.sites.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
}
function endpoint(value: unknown): string {
  if (typeof value !== "string") return "";
  try { return host(new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^\[|\]$/g, "")); }
  catch { return ""; }
}
export async function allTasks(call: Call, aid?: number): Promise<Row[]> {
  const rows: Row[] = [];
  let total = Infinity;
  while (rows.length < total) {
    const page = await call("cert_deploy_query", { action: "list", ...(aid === undefined ? {} : { aid }), offset: rows.length, limit: 100 });
    if (!Array.isArray(page?.rows) || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error("部署任务列表格式无效");
    total = page.total;
    if (!page.rows.length && rows.length < total) throw new Error("部署任务分页不完整，请重新查询");
    if (page.rows.some((r: Row) => rows.some(old => old.id === r.id))) throw new Error("部署任务分页发生变化，请重新查询");
    rows.push(...page.rows);
  }
  return rows;
}

export interface Filters { domain?: string; ip?: string; site?: string; aid?: number; oid?: number }
export async function findTasks(call: Call, filters: Filters) {
  if (!filters.domain && !filters.ip && !filters.site && filters.aid === undefined && filters.oid === undefined) throw new Error("至少指定 --domain、--ip、--site、--aid 或 --oid");
  const rows = await allTasks(call, filters.aid);
  const matches = [];
  for (const row of rows) {
    if (filters.oid !== undefined && Number(row.oid) !== filters.oid) continue;
    const targets = sites(row);
    const reasons: string[] = [];
    if (filters.domain) {
      const exact = targets.some(s => host(s) === host(filters.domain!));
      const covered = Array.isArray(row.domains) && row.domains.some((d: string) => covers(d, filters.domain!));
      if (!exact && !covered) continue;
      if (exact) reasons.push("site_domain");
      if (covered) reasons.push("certificate_domain");
    }
    if (filters.ip) {
      if (endpoint(row.aname) !== endpoint(filters.ip)) continue;
      reasons.push("account_host");
    }
    if (filters.site) {
      if (!targets.includes(filters.site.trim())) continue;
      reasons.push("site");
    }
    const c = config(row);
    // 只投影部署目标字段，不输出账户配置和适配器中的其他配置。
    matches.push({ id: row.id, aid: row.aid, oid: row.oid, type: row.type, deploy_type: c.type,
      account_host: endpoint(row.aname), sites: targets, domains: row.domains,
      active: row.active, status: row.status, remark: row.remark, matched_by: reasons });
  }
  return { total: matches.length, rows: matches };
}

export async function ensureTask(call: Call, options: { aid: number; oid: number; site: string; domain: string; id?: number }) {
  const { aid, oid, domain, id } = options;
  const site = options.site.trim();
  if (!site || /[\r\n]/.test(site)) throw new Error("--site 必须为一个部署站点名称");
  const orders = await call("cert_order_query", { action: "list", id: oid });
  const order = orders?.rows?.find((r: Row) => Number(r.id) === oid);
  if (!order || !Array.isArray(order.domains) || !order.domains.some((d: string) => covers(d, domain))) throw new Error("指定证书未覆盖 --domain，不能复用");
  if (Number(order.status) !== 3 || Number(order.isauto) !== 1 || Date.parse(order.expiretime) <= Date.now() || !Number.isFinite(Date.parse(order.expiretime))) throw new Error("指定证书必须已签发、未过期且开启自动续签");
  const rows = await allTasks(call, aid);
  const websiteTasks = rows.filter(r => r.type === "btpanel" && String(config(r).type) === "0");
  const existing = websiteTasks.filter(r => sites(r).includes(site));
  if (existing.some(r => Number(r.oid) !== oid) || existing.length > 1) throw new Error("该站点已有冲突或重复任务，请先核对任务");
  const candidates = websiteTasks.filter(r => Number(r.oid) === oid);
  let target: Row | undefined;
  if (id !== undefined) {
    target = candidates.find(r => Number(r.id) === id);
    if (!target || (existing.length && Number(existing[0].id) !== id)) throw new Error("--id 与账户、证书或现有站点任务不一致");
  } else {
    if (existing.length) target = existing[0];
    else if (candidates.length > 1) throw new Error(`存在多个可复用任务：${candidates.map(r => r.id).join(", ")}，请用 --id 选择`);
    else target = candidates[0];
  }
  if (target) {
    if (Number(target.active) !== 1) throw new Error(`任务 ${target.id} 已停用，请先核对并启用`);
    if (sites(target).includes(site)) return { action: "unchanged", id: target.id, aid, oid, site };
    const c = config(target);
    await call("cert_deploy_manage", { action: "edit", id: target.id, config: { ...c, sites: `${String(c.sites || "").trimEnd()}\n${site}`.trimStart() } });
    const updated = (await allTasks(call, aid)).find(r => r.id === target!.id);
    if (!updated || !sites(updated).includes(site)) throw new Error("更新后未查到目标站点，请检查任务状态");
    return { action: "reused", id: target.id, aid, oid, site };
  }
  // 没有任务时仍需核对账户类型，不能把宝塔配置发给其他部署适配器。
  const accounts = await call("cert_account_query", { deploy: 1, kw: String(aid), limit: 100 });
  if (!accounts?.rows?.some((r: Row) => Number(r.id) === aid && r.type === "btpanel")) throw new Error("ensure 当前仅支持宝塔网站证书，请核对 --aid");
  await call("cert_deploy_manage", { action: "add", aid, oid, config: { type: "0", sites: site }, remark: `${site} 自动部署SSL` });
  const created = (await allTasks(call, aid)).filter(r => Number(r.oid) === oid && r.type === "btpanel" && String(config(r).type) === "0" && sites(r).includes(site));
  if (created.length !== 1) throw new Error("创建后任务不唯一，请查询状态，不要重复添加");
  return { action: "created", id: created[0].id, aid, oid, site };
}
