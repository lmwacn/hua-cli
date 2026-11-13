# DNS、证书与证书部署任务

通过 `hua dns` 调用聚合 DNS 管理系统的 HTTP API，与网页后台和 MCP 共用权限、业务逻辑及任务数据。使用 CLI 不需要启动 MCP 客户端或本地常驻进程。证书续签与自动部署由服务器既有 `certtask` 调度执行；这里的“部署”指证书部署。

## 已配置的生产站点

截至 2026-11-13，本机 DNS profile `production` 指向 `https://dns.lmwa.cn`，使用管理员 `meng`（UID `1000`）的已有 API 权限。该站点源码位于 SSH profile `ali207` 的 `/www/wwwroot/dns.lmwa.cn`。DNS 和 SSH profile 属于不同配置，不按名称互相推断。

- DNS 配置：`~/.hua/dns.json`，只保存站点、用户 ID 和凭证来源。
- 本机密钥文件：`~/.hua/keys/dns.lmwa.cn-meng.apikey`，权限 `0600`，内容仅为 apikey，不是 `uid:apikey`。
- 已配置时直接复用，不读取或展示密钥内容，不重新导出或更换密钥。目标变化或配置存疑时用 `hua dns profile list` 核对。

涉及该站点时显式使用 `-p production`。其他站点按任务和现有配置选择 profile，不因它是默认值就采用它。

## 查询与参数发现

```bash
hua dns domain list --kw example.com -p production
hua dns domain info --id <domain-id> -p production
hua dns record list --domain-id <domain-id> -p production
hua dns cert list --domain example.com -p production
hua dns deploy list --domain example.com -p production
hua dns account cert list -p production
hua dns account deploy list -p production
hua dns providers --category deploy --type btpanel -p production
```

`domain list` 的关键词搜索可能返回多个域名，按实际名称确认 ID。`domain info` 可读取解析线路和最小 TTL。服务商账户和部署任务配置字段按适配器变化，用 `providers --category dns|cert|deploy --type <type>` 查询；部署任务使用返回的 `taskinputs`，不要混用其他类型的字段。

常用命令参数查看对应 `--help`；需要完整操作定义或扩展操作时，按需调用 `hua dns tools -p production`，不必每次加载全部定义。

## DNS 记录

```bash
hua dns record add --domain-id <domain-id> --name www --type A --value 192.0.2.10 --ttl 600 -p production
hua dns record update --domain-id <domain-id> --recordid <RecordId> --name www --type A --value 192.0.2.11 --line <line-id> --ttl 600 -p production
hua dns record status --domain-id <domain-id> --recordid <RecordId> --status 0 -p production
hua dns record delete --domain-id <domain-id> --recordid <RecordId> -p production
```

`domain-id` 是本系统域名 ID，`RecordId` 来自该域名的记录查询。修改时传完整的记录值、线路及 TTL 等字段，保留用户未要求更改的属性；不要假定 update 是局部合并。`add` 不提供自动去重或 upsert；用户要求“确保存在”或恢复超时操作时，先查询匹配的记录再决定添加或更新。

## 证书与部署任务

```bash
hua dns cert add --aid <ca-account-id> --domains 'example.com,*.example.com' -p production
hua dns cert auto --id <order-id> --isauto 1 -p production
hua dns cert process --id <order-id> --timeout 120000 -p production
hua dns cert logs --processid <processid> -p production

hua dns deploy add --aid <deploy-account-id> --oid <order-id> --config @deploy-config.json --remark <remark> -p production
hua dns deploy edit --id <task-id> --remark <remark> -p production
hua dns deploy active --id <task-id> --active 0 -p production
hua dns deploy process --id <task-id> --timeout 120000 -p production
hua dns deploy logs --processid <processid> -p production
```

- 订单的 `aid` 是签发账户 ID，部署任务的 `aid` 是部署账户 ID，`oid` 是证书订单 ID；不要相互混用。创建后按账户、绑定域名及备注确认实际订单或任务 ID，不默认取列表第一项。
- `cert add` 创建订单，默认开启自动续签；`cert process` 推进一轮申请，可能还在等待 DNS 验证。最终以订单 `status=3` 确认签发完成。失败时先检查错误及日志，并遵守服务端重试间隔。
- `deploy add` 创建的任务默认启用，可能随后被服务器自动执行。若用户只要求准备配置，先准备参数文件。修改备注等局部字段可用 `deploy edit`，未传的配置字段由共用业务层保留。
- 部署任务 `status=1` 表示执行完成；涉及实际安装效果时，再按目标检查证书文件或 HTTPS 服务。失败后先查询状态和日志；需要重新执行已完成任务时可用 `deploy process --reset 1`，仅在当前授权范围内使用。
- `processid` 来自对应订单或任务列表，不是订单或任务的数字 ID。成功调用接口不等于证书已签发或目标服务已更新。

## 参数、输出与错误

命令支持 `--data '{...}'`、`--data @params.json` 和 `--data -`（stdin）。显式选项覆盖同名 data 字段，资源命令固定自己的 action。完整 JSON 对象也可通过通用调用传入：

```bash
hua dns call record_query --data '{"action":"list","domain_id":12}' -p production
```

配置含凭证时使用本地文件或 stdin，避免进入命令历史。默认 JSON 输出隐藏配置、私钥等敏感字段；仅在用户要求的导出确实需要时使用 `--show-secrets`，将内容保存到受限文件，不在对话或日志中展示。失败返回非零退出码。请求不自动重试；超时后服务端可能仍在执行，先查询对应记录、订单或任务再决定下一步。

管理员可管理证书与部署任务；旧普通账号按域名授权操作，用户中心客户账号不能调用本管理接口。遇到 401 时核对 profile、凭证来源、账号状态与 API 开关，不自行提权。

## 新增或修复站点配置

仅在需要配置时使用，不为普通查询重建已有 profile：

```bash
hua dns profile add <profile> --base-url https://<site> --uid <uid> --token-file /absolute/path/apikey
hua dns profile add <profile> --base-url https://<site> --uid <uid> --token-env HUA_DNS_TOKEN
```

远程站点必须用 HTTPS；HTTP 仅支持本机联调。`profile add` 整体替换该 profile，更新时保留完整站点、用户 ID 与凭证来源。验证连接可使用域名、证书或任务列表查询，无需创建测试解析或触发签发。若 API 错误响应变成 HTML，检查服务器是否拦截了 PHP 错误响应；本生产站点已在 Nginx 中为 `/api/v1/` 配置保留 JSON 错误响应。
