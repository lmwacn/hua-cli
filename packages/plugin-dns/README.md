# DNS 插件

通过普通 HTTP JSON API 管理聚合 DNS 系统。服务端与 MCP 共用认证、工具注册表、权限及任务数据；不需要本地常驻进程。仅管理 DNS、证书签发和证书部署任务，不发布网站代码。

## 配置

站点先部署 DNS 项目的 `/api/v1/tools` 接口。在后台用户管理中开启该账号的 API 权限，使用其用户 ID 和 API 密钥。管理员可管理证书及部署任务；原普通账号仅能操作获授权的域名；用户中心客户账号不能调用本管理接口。

```bash
hua dns profile add production --base-url https://dns.lmwa.cn --uid 1 --token-file /absolute/path/dns-apikey
hua dns profile list
hua dns tools -p production
```

`--uid 1` 只是示例，需替换成实际账号 ID。密钥文件仅包含 apikey，建议权限 `600`。也可用 `--token-env HUA_DNS_TOKEN` 从已有环境变量读取。profile 存在 `~/.hua/dns.json`，不保存 API 密钥。远程站点必须使用 HTTPS；仅本机测试支持 HTTP。

## 完整操作流程

```bash
# 查询已接入域名，获取域名 ID；线路与最小 TTL 可通过 domain info 查询。
hua dns domain list -p production
hua dns domain info -p production --id 12
hua dns record add -p production --domain-id 12 --name www --type A --value 192.0.2.10 --ttl 600
hua dns record list -p production --domain-id 12

# 选择签发账户，创建订单。add 仅创建订单，process 推进申请流程。
hua dns account cert list -p production
hua dns cert add -p production --aid 3 --domains 'example.com,*.example.com'
hua dns cert list -p production
hua dns cert auto -p production --id 20 --isauto 1
hua dns cert process -p production --id 20 --timeout 120000

# 查询部署账户类型的 taskinputs，按实际字段准备配置文件。
hua dns account deploy list -p production
hua dns providers -p production --category deploy --type btpanel
hua dns deploy add -p production --aid 5 --oid 20 --config @deploy-config.json --remark example.com
hua dns deploy list -p production
hua dns deploy active -p production --id 30 --active 1
hua dns deploy process -p production --id 30 --timeout 120000
hua dns deploy logs -p production --processid <任务列表返回的processid>
```

上面的 ID、域名和地址都是示例。部署任务创建后默认为启用，与网页后台中的任务完全相同。证书签发可能需要多轮 DNS 验证，`process` 返回成功表示本轮调用成功，请查询订单 `status=3` 确认签发完成。自动签发、续签和后续部署由服务器既有 `certtask` 调度运行。

资源命令支持 `--data '{...}'`、`--data @params.json` 和 `--data -`（stdin），可传入 `--help` 未列出的筛选及适配器参数。显式命令行字段覆盖 `--data` 同名字段；命令本身决定 action，不能用 data 更换 action。

```bash
hua dns call record_query -p production --data '{"action":"list","domain_id":12}'
hua dns deploy edit -p production --id 30 --remark '更新备注'
hua dns deploy process -p production --id 30 --reset 1
hua dns record status -p production --domain-id 12 --recordid <RecordId> --status 0
```

默认以 JSON 输出，并隐藏账户配置、私钥等敏感字段；显式使用 `--show-secrets` 才输出原始内容。业务失败、认证失败和网络失败均以非零退出码结束。请求不自动重试、不跟随重定向；超时后先查询状态，避免重复添加记录或任务。

`hua dns tools` 显示当前账号可用操作和完整参数说明。`hua dns call` 也可调用现有 MCP 注册表中其他已授权操作。

## 查找与复用部署任务

添加任务前先查找。`deploy find` 自动读取所有分页，显示任务 ID、账户主机、部署类型、站点列表、证书域名、启用状态和匹配依据；不输出完整配置或密钥。

```bash
# 域名匹配已部署站点或证书覆盖范围，支持一级通配符。
hua dns deploy find --domain pan.example.com -p production
# IP 匹配部署账户地址中的主机，不做 DNS 解析。
hua dns deploy find --ip 192.0.2.10 -p production
# 部署站点名称精确匹配；多个筛选条件取交集。
hua dns deploy find --site pan.example.com --aid 2 -p production
hua dns deploy find --domain pan.example.com --ip 192.0.2.10 -p production

# 明确账户、证书、站点及实际访问域名后，确保自动部署任务存在。
hua dns deploy ensure --aid 2 --oid 1 --site pan.example.com --domain pan.example.com -p production
```

`--domain` 命中通配符证书表示候选任务的证书可覆盖该域名，不代表该站点已部署。`matched_by` 中 `site_domain` / `site` 表示站点命中，`certificate_domain` 表示证书覆盖，`account_host` 表示账户主机命中。

`ensure` 当前支持宝塔网站证书（部署类型 `0`）。先核对证书已签发、未过期、覆盖 `--domain` 且开启自动续签，再复用同账户、同证书、同部署类型的任务：已有站点返回 `unchanged`，追加站点返回 `reused`，完全没有候选时才创建并返回 `created`。追加时保留原站点和其他配置。多个候选需传 `--id`；停用任务、重复站点或其他证书冲突会报错，不自动另建任务。

`ensure` 不立即执行部署，不自动重置原任务。首次安装仍需对返回的任务 ID 执行 `deploy process`；已完成任务需要重新执行时加 `--reset 1`。复用批量任务后执行会涉及其中全部站点。证书后续续签由服务器既有调度自动触发部署。

## 本地检查

在 hua-cli 根目录运行：

```bash
npm run build
npm test -w @hua/plugin-dns
```

跨项目 HTTP/MCP/CLI 集成验证见 DNS 项目 `docs/HTTP自动化接口.md`。
