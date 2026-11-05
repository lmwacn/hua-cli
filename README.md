# hua-cli

一个基于 Node.js + TypeScript 的插件化 CLI 工具骨架。

内置了 `sql`、`http`、`ssh`、`tts`、`qiniu`、`gmail` 等插件，分别用于数据库查询、HTTP 请求测试、远程服务器管理、语音合成、七牛云对象存储管理和 Gmail 邮件操作。

## 特性

- 基于 `commander` 的命令行解析
- 使用 workspace 组织多个包
- 通过插件接口注册命令
- 支持通过 `npm link` 在本机全局使用 `hua`

## 项目结构

```text
hua-cli/
  packages/
    cli/          # CLI 入口
    core/         # 命令注册与运行时
    plugin-sdk/   # 插件接口定义
    plugin-sql/   # MySQL / PostgreSQL 数据库查询
    plugin-http/  # HTTP 请求测试
    plugin-ssh/   # SSH 远程服务器管理
    plugin-tts/   # 阿里云百炼语音合成
    plugin-qiniu/ # 七牛云对象存储管理
    plugin-gmail/ # Gmail 邮件操作
```

## 环境要求

- Node.js 18+
- npm 9+

## 安装依赖

```bash
npm install
```

## 构建

```bash
npm run build
```

## 本地运行

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js sql --help
node packages/cli/dist/index.js sql query "select 1" --profile dev
```

也可以使用根脚本：

```bash
npm run hua -- --help
npm run hua -- sql --help
```

## 全局使用

在项目根目录执行：

```bash
npm install
npm run build
npm link
```

完成后即可在任意目录直接使用：

```bash
hua --help
hua sql --help
hua sql profile list
hua sql query "select 1" --profile dev
```

取消全局链接：

```bash
npm unlink -g hua-cli
```

如果只是移除当前项目和全局命令的关联，也可以重新进入项目目录后执行：

```bash
npm unlink
```

## 当前命令

### SQL 插件

同一套 `hua sql` 命令支持 MySQL 和 PostgreSQL，通过 profile 的 `driver` 选择。旧配置无需迁移，未指定 driver 时仍使用 MySQL。

```bash
hua sql profile add dev --host 127.0.0.1 --port 3306 --user root --database test
hua sql profile add pg-dev --driver postgres --host 127.0.0.1 --user postgres --database test
hua sql profile list
hua sql profile use dev
hua sql profile show
hua sql profile remove dev
hua sql query "SELECT * FROM users LIMIT 10" --profile dev
hua sql query "SELECT current_database(), version()" -p pg-dev
hua sql shell -p pg-dev < ./script.sql
```

PostgreSQL 默认端口为 `5432`，MySQL 为 `3306`。使用 `--ssl` 启用证书校验，私有 CA 使用 `--ssl-ca /absolute/path/ca.pem`。事务、批量执行和配置说明见 [SQL 使用说明](./docs/sql.md)。

### HTTP 插件

```bash
hua http profile add dev --base-url http://localhost:3000
hua http profile list
hua http get /api/users --profile dev
hua http post /api/users --data '{"name":"test"}' -H "Content-Type: application/json"
```

### SSH 插件

```bash
hua ssh profile add prod --host 1.2.3.4 --username root --password xxx
hua ssh profile list
hua ssh exec -p prod "uname -a && df -h"
hua ssh upload ./file.txt /remote/path/file.txt
hua ssh upload-dir ./dist /opt/app -p prod --clear --exclude node_modules
hua ssh download /remote/path/file.txt ./local-file.txt
```

`upload-dir` 会先把本地目录打成临时 `tar.gz`，上传到远端临时目录，远端解压后自动删除远端临时包，本地临时包也会自动清理。默认解压目录内容到目标目录（`--strip-components 1`）；如需保留本地目录名，使用 `--strip-components 0`。

### TTS 插件

```bash
hua tts config set --api-key sk-xxx --voice Chelsie
hua tts config show
hua tts gen "你好，我是 Chelsie" -o output.wav
hua tts gen --file input.txt -o output.wav
hua tts gen "hello" --language English --voice Chelsie -o hello.wav
```

TTS 配置存储在 `~/.hua/tts.json`，保存时会将文件权限设置为 `0600`。其他插件配置存储在各自的 `~/.hua/*.json` 文件中。

### 七牛云插件

推荐通过环境变量提供凭证，Profile 默认引用 `QINIU_ACCESS_KEY` 和 `QINIU_SECRET_KEY`：

```bash
hua qiniu profile add dev --region z0
hua qiniu profile test
hua qiniu bucket list
hua qiniu bucket info my-bucket
hua qiniu bucket domains my-bucket
hua qiniu object list my-bucket --prefix images/
hua qiniu object upload my-bucket ./logo.png --key images/logo.png
hua qiniu object download my-bucket images/logo.png -o ./logo.png
hua qiniu object stat my-bucket images/logo.png
hua qiniu object url my-bucket images/logo.png --expires 3600

# CDN 域名、缓存和统计
hua qiniu cdn domain list
hua qiniu cdn domain info cdn.example.com
hua qiniu cdn refresh-url https://cdn.example.com/images/logo.png
hua qiniu cdn refresh-dir https://cdn.example.com/images/
hua qiniu cdn prefetch https://cdn.example.com/images/logo.png
hua qiniu cdn traffic cdn.example.com --from 2026-08-01 --to 2026-08-07
hua qiniu cdn bandwidth cdn.example.com --from 2026-08-01 --to 2026-08-07 --granularity hour
hua qiniu cdn logs cdn.example.com --date 2026-08-07
```

也可以使用 `--access-key`、`--secret-key` 保存凭证。七牛配置存储在 `~/.hua/qiniu.json`，目录权限为 `0700`，文件权限为 `0600`。删除空间或对象必须显式传入 `--yes`；上传、复制、移动和本地下载默认不覆盖已有目标，需使用 `--force`。

CDN 域名的创建、上下线、删除和配置修改均要求 `--yes`。创建和修改使用 JSON 文件传入官方 API 请求体，避免敏感配置进入命令历史：

```bash
hua qiniu cdn domain create cdn.example.com --config ./domain-create.json --yes
hua qiniu cdn domain update cdn.example.com cache --config ./cache.json --yes
hua qiniu cdn domain offline cdn.example.com --yes
hua qiniu cdn domain online cdn.example.com --yes
hua qiniu cdn domain delete cdn.example.com --yes
```

`domain update` 支持 `geocover`、`source`、`range`、`sourcetimeout`、`cache`、`respheader`、`sslize`、`httpsconf`、`referer`、`ipacl`、`uaacl`、`timeacl`、`bsauth` 配置段。域名管理与 CDN 用量接口需要当前 AK/SK 具备对应权限。

## Gmail

`hua gmail` 通过 Gmail API 搜索邮件、读取会话、管理草稿、发送和下载附件。结果以 JSON 输出。用 `-p` 选择账号配置，默认名称为 `default`。

```bash
# 有旧独立 CLI 的授权时，直接导入已有令牌。
hua gmail auth import -p default
# 首次授权时使用 Google Cloud 的桌面应用客户端 JSON。
hua gmail auth login --credentials ./client_secret.json -p default
hua gmail profile -p default
hua gmail search 'is:unread newer_than:7d' --limit 10 -p default
hua gmail read MESSAGE_ID -p default
hua gmail thread THREAD_ID -p default
hua gmail attachment MESSAGE_ID ATTACHMENT_ID --output ./report.pdf -p default
hua gmail draft create --to user@example.com --subject '主题' --body '正文' -p default
hua gmail send --to user@example.com --subject '主题' --body-file ./mail.txt --dry-run -p default
hua gmail draft send DRAFT_ID -p default
```

首次授权前，在 Google Cloud 项目启用 Gmail API 并创建桌面应用 OAuth 客户端。[Google 官方配置文档](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)

登录时可加 `--readonly` 仅授予读取权限，或加 `--no-browser` 手动打开授权链接。已有 profile 可直接执行 `auth login -p NAME` 重新授权。`auth import -p NAME --from OLD_NAME` 读取旧目录 `~/.config/gmail-cli` 或 `GMAIL_CLI_HOME`，目标 profile 已授权时拒绝覆盖。授权保存在 `~/.hua/gmail/<profile>/token.json`，可用 `HUA_GMAIL_HOME` 指定另一根目录。文件含刷新令牌，请妥善保管。`auth logout` 清除本机授权文件。

`draft create` 和 `send` 支持 `--reply-to MESSAGE_ID`、重复的收件人或附件参数，以及用 `--body-file -` 从标准输入读取正文。`send` 和 `draft send` 会立即发信，发送超时后先查看已发送邮件。`send --dry-run` 只预览内容。

项目 Skill 位于 [.agents/skills/hua-cli](./.agents/skills/hua-cli/SKILL.md)。

## 插件开发

插件开发规范见 [docs/plugin-development.md](./docs/plugin-development.md)。

最小插件示例：

```ts
import { definePlugin } from "@hua/plugin-sdk";

export const helloPlugin = definePlugin({
  name: "hello",
  description: "example plugin",
  commands: [
    {
      name: "say <name>",
      description: "say hello",
      async action(context) {
        context.log(`hello, ${context.args[0]}`);
      },
    },
  ],
});
```

## 开发建议

- 将参数解析放在 `commands`
- 将业务逻辑放在 `services`
- 将第三方能力封装放在 `drivers`
- 保持 `core` 不直接依赖具体业务插件

## 下一步计划

- SSH 插件：增加 `tunnel`（端口转发）命令
- HTTP 插件：增加响应格式化、历史记录等功能
- SQL 插件：支持更多输出格式（json/csv）、专用脚本文件参数
- 通用：项目级配置覆盖、环境变量支持
