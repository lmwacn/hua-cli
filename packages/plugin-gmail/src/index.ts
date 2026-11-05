import { definePlugin, type CommandContext, type CommandOption, type HuaCommand } from "@hua/plugin-sdk";
import type { gmail_v1 } from "@googleapis/gmail";
import { readFile } from "node:fs/promises";
import { authStatus, gmailService, importAuthorization, login, logout } from "./auth";
import { compose, download, summarize } from "./messages";

const profile: CommandOption = { flags: "-p, --profile <name>", description: "Gmail profile（默认 default）" };
const pagination: CommandOption[] = [
  { flags: "--limit <count>", description: "每页 1–500 条（默认 20）" },
  { flags: "--page-token <token>", description: "继续读取下一页" },
];

function repeated(flags: string, description: string): CommandOption {
  return { flags, description, processor: (value: string, previous: string[]) => [...previous, value] };
}

const composition = [
  repeated("--to <address>", "收件人，可重复"),
  repeated("--cc <address>", "抄送，可重复"),
  repeated("--bcc <address>", "密送，可重复"),
  { flags: "--subject <text>", description: "邮件主题" },
  { flags: "--body <text>", description: "纯文本正文" },
  { flags: "--body-file <path>", description: "UTF-8 正文文件，- 表示标准输入" },
  repeated("--attach <path>", "附件，可重复"),
  { flags: "--reply-to <message-id>", description: "回复原邮件，默认使用原主题和收件人" },
  { flags: "--dry-run", description: "预览邮件内容" },
];

type Options = {
  profile?: string; credentials?: string; from?: string; readonly?: boolean; noBrowser?: boolean;
  limit?: string; pageToken?: string; idsOnly?: boolean; includeSpamTrash?: boolean;
  to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; body?: string;
  bodyFile?: string; attach?: string[]; replyTo?: string; dryRun?: boolean; output?: string;
};

type Handler = (profile: string, args: string[], options: Options) => unknown | Promise<unknown>;

function command(name: string, description: string, action: Handler, options: CommandOption[] = [], parentPath?: string[]): HuaCommand {
  return { name, description, parentPath, options: [profile, ...options], async action(context: CommandContext) {
    const options = context.options as Options;
    try {
      const value = await action(options.profile ?? "default", context.args, options);
      context.log(JSON.stringify(value, null, 2));
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const message = status ? `Gmail API 请求失败（HTTP ${status}）`
        : error instanceof Error ? error.message : String(error);
      context.error(JSON.stringify({ error: message, status }, null, 2));
      process.exitCode = 1;
    }
  } };
}

function page(options: Options) {
  const maxResults = Number(options.limit ?? "20");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 500) {
    throw new Error("--limit 需要为 1–500 的整数");
  }
  return { maxResults, pageToken: options.pageToken };
}

function requireOption(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`请指定 ${flag}`);
  return value;
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  return body;
}

async function writeMessage(profile: string, options: Options, draft: boolean) {
  if ((options.body === undefined) === (options.bodyFile === undefined)) {
    throw new Error("请指定 --body 或 --body-file，两者只能选其一");
  }
  const text = options.bodyFile === "-" ? await readStdin()
    : options.bodyFile !== undefined ? await readFile(options.bodyFile, "utf8")
    : options.body ?? "";

  const api = options.replyTo || !options.dryRun ? await gmailService(profile, !options.dryRun) : undefined;
  let original: gmail_v1.Schema$Message | undefined;
  if (api && options.replyTo) {
    ({ data: original } = await api.users.messages.get({
      userId: "me", id: options.replyTo, format: "metadata",
      metadataHeaders: ["From", "Reply-To", "Subject", "Message-ID", "References"],
    }));
  }
  const { message, preview } = await compose({
    to: options.to ?? [], cc: options.cc ?? [], bcc: options.bcc ?? [],
    subject: options.subject, text, files: options.attach ?? [],
  }, original);
  if (!api || options.dryRun) return { dryRun: true, preview };
  const { data } = draft
    ? await api.users.drafts.create({ userId: "me", requestBody: { message } })
    : await api.users.messages.send({ userId: "me", requestBody: message });
  return data;
}

export const gmailPlugin = definePlugin({
  name: "gmail",
  description: "搜索、读取、起草和发送 Gmail 邮件",
  commands: [
    command("login", "使用桌面应用 OAuth 客户端授权", (p, _, o) =>
      login(p, o.credentials, Boolean(o.readonly), o.noBrowser === false), [
      { flags: "--credentials <path>", description: "Google 桌面应用 OAuth 客户端 JSON" },
      { flags: "--readonly", description: "仅授予邮件读取权限" },
      { flags: "--no-browser", description: "在终端显示链接，手动打开浏览器" },
    ], ["auth"]),
    command("import", "迁移独立 Gmail CLI 的本地授权", (p, _, o) => importAuthorization(p, o.from ?? p), [
      { flags: "--from <name>", description: "旧账号别名（默认与目标 profile 相同）" },
    ], ["auth"]),
    command("status", "检查本地授权状态", authStatus, [], ["auth"]),
    command("logout", "删除本机令牌", logout, [], ["auth"]),
    command("profile", "验证授权并显示当前邮箱", async (p) =>
      (await (await gmailService(p)).users.getProfile({ userId: "me" })).data),
    command("labels", "列出 Gmail 标签", async (p) =>
      (await (await gmailService(p)).users.labels.list({ userId: "me" })).data),
    command("search <query>", "使用 Gmail 查询语法搜索邮件", async (p, [q], o) => {
      const paging = page(o);
      const api = await gmailService(p);
      const { data } = await api.users.messages.list({ userId: "me", q, ...paging, includeSpamTrash: o.includeSpamTrash });
      if (o.idsOnly) return data;
      const messages = [];
      for (const { id } of data.messages ?? []) {
        if (!id) continue;
        const { data: message } = await api.users.messages.get({ userId: "me", id,
          format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] });
        messages.push(summarize(message));
      }
      return { ...data, messages };
    }, [...pagination, { flags: "--ids-only", description: "仅返回邮件与会话 ID" },
      { flags: "--include-spam-trash", description: "包含垃圾邮件和废纸篓" }]),
    command("read <id>", "读取邮件正文和附件信息", async (p, [id]) => {
      const { data } = await (await gmailService(p)).users.messages.get({ userId: "me", id, format: "full" });
      return summarize(data, true);
    }),
    command("thread <id>", "读取整个会话", async (p, [id]) => {
      const { data } = await (await gmailService(p)).users.threads.get({ userId: "me", id, format: "full" });
      return { ...data, messages: (data.messages ?? []).map((message) => summarize(message, true)) };
    }),
    command("attachment <message-id> <attachment-id>", "下载附件", async (p, [id, attachmentId], o) => {
      const output = requireOption(o.output, "--output");
      return download(await gmailService(p), id, attachmentId, output);
    }, [{ flags: "--output <path>", description: "本地目标文件，拒绝覆盖" }]),
    command("send", "立即发送邮件，或用 --dry-run 预览", (p, _, o) => writeMessage(p, o, false), composition),
    command("create", "创建 Gmail 草稿", (p, _, o) => writeMessage(p, o, true), composition, ["draft"]),
    command("list", "列出 Gmail 草稿", async (p, _, o) => {
      const paging = page(o);
      return (await (await gmailService(p)).users.drafts.list({ userId: "me", ...paging })).data;
    }, pagination, ["draft"]),
    command("get <id>", "读取草稿内容", async (p, [id]) => {
      const { data } = await (await gmailService(p)).users.drafts.get({ userId: "me", id, format: "full" });
      return { ...data, message: summarize(data.message ?? {}, true) };
    }, [], ["draft"]),
    command("send <id>", "立即发送指定草稿", async (p, [id]) =>
      (await (await gmailService(p, true)).users.drafts.send({ userId: "me", requestBody: { id } })).data, [], ["draft"]),
  ],
});
