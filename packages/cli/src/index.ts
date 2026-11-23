#!/usr/bin/env node
import { HuaCliApp } from "@hua/core";
import { sqlPlugin } from "@hua/plugin-sql";
import { httpPlugin } from "@hua/plugin-http";
import { sshPlugin } from "@hua/plugin-ssh";
import { weixinPlugin } from "@hua/plugin-weixin";
import { qiniuPlugin } from "@hua/plugin-qiniu";
import { gmailPlugin } from "@hua/plugin-gmail";

import { dnsPlugin } from "@hua/plugin-dns";

async function main(): Promise<void> {
  const app = new HuaCliApp();
  app.registerPlugin(sqlPlugin);
  app.registerPlugin(httpPlugin);
  app.registerPlugin(sshPlugin);
  app.registerPlugin(weixinPlugin);
  app.registerPlugin(qiniuPlugin);
  app.registerPlugin(gmailPlugin);
  app.registerPlugin(dnsPlugin);
  await app.run(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
