import type { gmail_v1 } from "@googleapis/gmail";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import MailComposer from "nodemailer/lib/mail-composer";

type Message = gmail_v1.Schema$Message;
type Part = gmail_v1.Schema$MessagePart;

export function headers(part?: Part | null): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const header of part?.headers ?? []) {
    if (!header.name || !header.value) continue;
    const name = header.name.toLowerCase();
    result[name] = [result[name], header.value].filter(Boolean).join(", ");
  }
  return result;
}

function* parts(part: Part): Generator<Part> {
  yield part;
  for (const child of part.parts ?? []) yield* parts(child);
}

export function summarize(message: Message, full = false) {
  const { id, threadId, labelIds, snippet, internalDate, payload } = message;
  const metadata = { id, threadId, labelIds, snippet, internalDate, headers: headers(payload) };
  if (!full) return metadata;
  const text: string[] = [];
  const html: string[] = [];
  const attachments = [];
  for (const part of parts(payload ?? {})) {
    const { body, mimeType, filename, partId } = part;
    if (filename || body?.attachmentId) {
      attachments.push({ filename: filename || "", mimeType, partId,
        attachmentId: body?.attachmentId ?? null, size: body?.size ?? 0 });
    } else if (body?.data && (mimeType === "text/plain" || mimeType === "text/html")) {
      const bytes = Buffer.from(body.data, "base64url");
      const charset = headers(part)["content-type"]?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
      let content: string;
      try {
        content = new TextDecoder(charset ?? "utf-8").decode(bytes);
      } catch {
        content = bytes.toString("utf8");
      }
      (mimeType === "text/plain" ? text : html).push(content);
    }
  }
  return { ...metadata, text: text.join("\n"), html: html.join("\n"), attachments };
}

export interface ComposeOptions {
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  text: string;
  files: string[];
}

export async function compose(options: ComposeOptions, original?: Message) {
  const source = headers(original?.payload);
  const to = options.to.length ? options.to : [source["reply-to"] || source.from].filter(Boolean);
  if (!to.length) throw new Error("请指定 --to 或提供含发件人的原邮件");
  if (original && (!original.threadId || !source["message-id"])) {
    throw new Error("原邮件缺少 threadId 或 Message-ID，无法构造回复");
  }
  let subject = options.subject;
  if (original && subject === undefined) {
    const prior = source.subject ?? "";
    subject = /^re:/i.test(prior) ? prior : `Re: ${prior}`;
  }
  if (subject === undefined) throw new Error("请指定 --subject");
  for (const value of [...to, ...options.cc, ...options.bcc, subject]) {
    if (/[\r\n\0]/.test(value)) throw new Error("收件人和主题不能包含换行或空字符");
  }
  const attachments = await Promise.all(options.files.map(async (file) => ({
    filename: basename(file), content: await readFile(file),
  })));
  const mime = new MailComposer({
    to, cc: options.cc, bcc: options.bcc, subject, text: options.text,
    inReplyTo: source["message-id"],
    references: [source.references, source["message-id"]].filter(Boolean).join(" ") || undefined,
    attachments,
  }).compile();
  mime.keepBcc = true;
  const raw = (await mime.build()).toString("base64url");
  const threadId = original?.threadId ?? undefined;
  return { message: { raw, threadId },
    preview: { to, cc: options.cc, bcc: options.bcc, subject,
      body: options.text, attachments: options.files, threadId } };
}

export async function download(api: gmail_v1.Gmail, messageId: string, id: string, output: string) {
  const { data } = await api.users.messages.attachments.get({ userId: "me", messageId, id });
  if (typeof data.data !== "string") throw new Error("Gmail 未返回附件内容");
  const bytes = Buffer.from(data.data, "base64url");
  const path = resolve(output);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  return { path, bytes: bytes.length };
}
