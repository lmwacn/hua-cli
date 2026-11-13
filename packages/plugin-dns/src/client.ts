import { DnsProfile, tokenFor } from "./profile-store";

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(config|ext|key|privatekey|private_key|apikey|password|passphrase|secret|token|pfx|pfx_pass|loginurl|info)$/i.test(key) ? "***" : redact(item)]));
}
export async function request(p: DnsProfile, tool?: string, args?: Record<string, unknown>, timeout = 30000): Promise<unknown> {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600000) throw new Error("timeout 必须为 1 至 3600000 毫秒");
  if (tool && !/^[a-z][a-z0-9_]*$/.test(tool)) throw new Error("操作名称无效");
  const token = tokenFor(p);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${p.baseUrl}/api/v1/tools${tool ? `/${tool}` : ""}`, {
      method: tool ? "POST" : "GET", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${p.uid}:${token}`, "Content-Type": "application/json" },
      body: tool ? JSON.stringify(args || {}) : undefined,
    });
    let data: any;
    try { data = await response.json(); } catch { throw new Error(`HTTP ${response.status}：站点未返回 JSON，请确认已部署 API`); }
    if (!response.ok || (typeof data?.code === "number" && data.code !== 0)) throw new Error(`HTTP ${response.status}：${data?.msg || "请求失败"}`);
    return data;
  } catch (e) {
    if (controller.signal.aborted) throw new Error("请求超时，操作可能仍在服务器执行，请先查询状态，不要直接重复提交");
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(message.split(token).join("***"));
  } finally { clearTimeout(timer); }
}
