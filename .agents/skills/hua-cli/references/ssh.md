# SSH

配置：`~/.hua/ssh.json`。单条命令使用 `exec`，连续操作需要复用连接时使用 `shell`，默认空闲 30 秒超时。仅诊断连通性时使用 `connect`，无需每次执行前重复测试连接。

```bash
hua ssh exec 'uname -a' -p <profile>
hua ssh shell -p <profile> <<'REMOTE'
uptime
df -h
exit
REMOTE
hua ssh upload <localPath> <remotePath> -p <profile>
hua ssh download <remotePath> <localPath> -p <profile>
```

带引号的 heredoc 保留变量与命令替换给远端 shell；需要本地值时明确、安全地传入，不硬性使用双引号。

## 目录部署

按项目发布流程执行，部署后核验实际运行结果。`upload-dir` 会打包、上传、解压并清理临时包。

```bash
hua ssh upload-dir <localDir> <remoteDir> -p <profile> --dry-run
hua ssh upload-dir <localDir> <remoteDir> -p <profile>
```

- `--strip-components` 默认 `1`，仅解压目录内容；`0` 保留本地目录名。
- `--exclude <pattern>` 可重复，`--remote-tmp <dir>` 指定远端临时目录。
- `--clear` 会删除远端目标目录；仅在已授权流程要求清空，且已核对路径、保留数据和恢复方式时使用，不作为默认参数。
- `upload` 和 `upload-dir` 依赖 SFTP；缺少 SFTP 时使用项目允许的流式传输或远端下载方式。
- 认证及连接管理参数按需查看 `hua ssh profile <command> --help`。
