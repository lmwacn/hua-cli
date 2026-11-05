# 七牛云

配置：`~/.hua/qiniu.json`，目录权限 `0700`、文件权限 `0600`。Profile、Bucket 和 CDN 域名从当前任务及配置确定，不在技能中固定。

## 目标与操作

按需使用 `profile list`、`bucket list`、`bucket domains` 或 `cdn domain list` 确定目标，不要求每次执行完整查询链。已确认的任务目标可复用；目标状态存疑或操作风险需要时再验证。

```bash
hua qiniu object list <bucket> --prefix <prefix> -p <profile>
hua qiniu object stat <bucket> <key> -p <profile>
hua qiniu object upload <bucket> <local-path> --key <key> -p <profile>
hua qiniu cdn refresh-url <url> -p <profile>
```

- 空间和对象命令显式传 Bucket；`defaultDomain` 用于对象 URL 和下载。
- 删除空间或对象需 `--yes`；上传、复制、移动及本地下载默认不覆盖，已授权覆盖才加 `--force`。这些标志不替代用户授权。
- CDN 域名创建、配置、上下线和删除也需 `--yes`；具体参数查看 `hua qiniu cdn domain --help`。
- 域名创建和配置修改用本地 JSON 文件传入请求体，避免敏感配置进入命令历史。
- 缓存、用量、日志及其他参数按对应子命令的 `--help` 查询；需要机器可读输出时使用命令支持的 `--json`。

## 凭证与 profile 更新

优先引用环境变量；用户明确要求保存凭证时才使用 `--access-key` 和 `--secret-key`，不在输出中展示真实值。

```bash
hua qiniu profile add <name> --access-key-env QINIU_ACCESS_KEY --secret-key-env QINIU_SECRET_KEY --region <region-id> --bucket <bucket> --domain https://<domain>
```

`profile add` 整体替换已有 profile，不是局部合并。更新时同时提供完整的凭证来源和需要保留的默认值。仅在凭证配置或连通性确实需要验证时执行 `profile test`。
