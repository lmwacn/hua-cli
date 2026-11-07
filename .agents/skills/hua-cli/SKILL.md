---
name: hua-cli
description: 使用 hua-cli 查询 MySQL / PostgreSQL、执行远程命令和文件传输、管理七牛云对象与 CDN，以及使用阿里云百炼生成配音、创建和管理克隆音色、搜索和处理 Gmail 邮件。用于这些操作及其账号配置，不用于普通 SQL 编写或无关代码修改。
---

# hua-cli

通过已安装的 `hua` 执行任务。参数不确定时查看 `hua <子命令> --help`，无需预读所有命令或参考资料。

## 按任务读取

- MySQL / PostgreSQL 查询、数据变更或数据库连接管理：[references/sql.md](references/sql.md)。
- SSH 远程执行、文件传输或服务器部署：[references/ssh.md](references/ssh.md)。
- 七牛云空间、对象、CDN 或凭证配置：[references/qiniu.md](references/qiniu.md)。
- 百炼语音合成、声音克隆、TTS Next 风格配音：[references/tts.md](references/tts.md)。
- Gmail 邮件读写、附件下载或 OAuth 配置：[references/gmail.md](references/gmail.md)。

只读当前操作需要的参考文件。其他子命令通过 `hua --help` 发现，不因工具支持而扩大任务范围。

## 公共约定

- 支持 profile 的子命令应复用已确认的目标，并显式传 `-p`。目标不明时按需查询对应子命令的账号查询方式；多个候选无法判断时询问，不因存在默认配置就认定它是任务目标。
- 配置管理只在任务需要时进行；不为一次操作改变全局默认。不同子命令的同名 profile 不保证指向相同环境。
- 查询可直接执行；变更沿用已有授权，执行前核对目标和影响范围。必要的备份、迁移与验证遵循项目流程，不重复索取已有授权。
- 不输出密码、密钥或私有签名 URL。配置优先通过 CLI 查询；必须读文件时只提取必要的非敏感字段。
- 使用正确的 shell 引用，明确变量及命令替换在本地还是远端执行。不要把敏感值直接拼入命令或日志。
