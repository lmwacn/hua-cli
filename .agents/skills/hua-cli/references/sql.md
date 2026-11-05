# SQL（MySQL / PostgreSQL）

配置：`~/.hua/sql.json`。通过 profile 的 `driver` 选择数据库；缺省为 MySQL，PostgreSQL 使用 `postgres`（兼容 `postgresql`、`pgsql`），未知值报错。先确认目标及 driver，再使用对应原生 SQL，不转换方言。

```bash
hua sql profile add pg-dev --driver postgres --host 127.0.0.1 --user postgres --database app
hua sql query 'SELECT current_database(), version()' -p pg-dev
```

默认端口：MySQL `3306`，PostgreSQL `5432`。`--ssl` 启用 TLS 和证书校验；`--ssl-ca /absolute/path/ca.pem` 指定私有 CA 并启用 TLS。连接管理参数通过 `hua sql profile <command> --help` 查看。

单条语句用 `query`；需要事务、连接状态或多条语句共享连接时使用同一次 `shell`。空闲超时默认 30 秒，可用 `--timeout` 调整；SQL 按分号分隔，`exit`、`quit`、`\q` 退出。

```bash
hua sql query 'SELECT 1' -p <profile>
hua sql shell -p <profile> <<'SQL'
SELECT 1;
SELECT 2;
exit
SQL
```

- 含反引号、变量或多行 SQL 时使用带引号的 heredoc，避免本地 shell 展开。
- 查询限定所需列和结果范围。数据变更核对条件及影响范围，并按项目要求使用备份、事务或迁移。
- 不要把需要共享事务的语句拆成多个独立 `query` 调用。
- 批量输入（heredoc、管道或文件重定向）遇错停止，返回非零状态；之前已提交的操作不会撤销，要求原子性时显式使用事务。交互模式遇错继续，PostgreSQL 失败事务需先 `ROLLBACK`。
- EOF/exit 等待当前语句完成；空闲超时不限制查询执行时长。支持 PostgreSQL dollar quote 和 `DO` 块；不支持 `psql` 元命令、`COPY FROM STDIN` 数据流或 MySQL `DELIMITER`，这些操作使用原生客户端。不要在 shell 中更改影响引号与转义的 SQL 模式。
