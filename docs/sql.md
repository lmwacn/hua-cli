# SQL 使用说明

`hua sql` 支持 MySQL 和 PostgreSQL。命令保持统一，SQL 使用目标数据库的原生语法，不自动转换方言。

## 连接配置

```bash
hua sql profile add my-dev --driver mysql --host 127.0.0.1 --user root --database app
hua sql profile add pg-dev --driver postgres --host 127.0.0.1 --user postgres --database app
hua sql profile list
hua sql profile show pg-dev
hua sql query 'SELECT current_database(), version()' -p pg-dev
```

配置保存在 `~/.hua/sql.json`，继续使用原有 profile 管理命令。`postgresql`、`pgsql` 是 `postgres` 的别名。未指定 driver 的命令及旧配置仍使用 MySQL；未知 driver 会报错，不回退或覆盖配置。默认端口分别为 MySQL `3306`、PostgreSQL `5432`，可用 `--port` 覆盖。

密码可通过现有 `--password` 参数配置；配置中的密码是明文，须按敏感文件管理，不提交到仓库。`profile show` 只显示掩码。PostgreSQL 连接使用 profile 中的参数，不依赖 `PGPASSWORD` 或 `PGSSLMODE`。

两种驱动都支持 `--ssl`，启用 TLS 并验证服务器证书。私有 CA 使用 `--ssl-ca /absolute/path/ca.pem`，该参数隐含启用 TLS。默认不启用 TLS；启用后连接失败不会降级为明文。相对 CA 路径按调用时工作目录解析，建议使用绝对路径。

## 查询、事务与脚本

单条查询使用 `query`。需要事务、临时表或多条语句共享连接时，使用一次 `shell`：

```bash
hua sql shell -p pg-dev <<'SQL'
BEGIN;
CREATE TEMP TABLE demo (id integer);
INSERT INTO demo VALUES (1) RETURNING id;
SELECT * FROM demo;
ROLLBACK;
SQL

hua sql shell -p pg-dev < ./script.sql
```

- `shell` 按顺序执行语句，支持 PostgreSQL dollar quote、`DO` 块、注释及字符串内分号。带引号的 heredoc 可防止本地 shell 展开变量。
- EOF 或独立一行的 `exit`、`quit`、`\q` 会等待已开始的语句完成再断开连接。EOF 时会执行没有结尾分号的完整语句；未闭合的引号或块注释会报错。
- 非交互批量执行遇错立即停止并以非零状态退出；未提交事务随连接关闭回滚，之前已提交或自动提交的写入不会撤销。需要原子性时显式使用事务，并遵循数据库自身的事务限制。
- 交互模式遇到 SQL 错误会显示错误并继续；PostgreSQL 事务失败后需要 `ROLLBACK` 才能继续操作。
- 默认空闲超时为 30 秒，可用 `--timeout <seconds>` 调整；执行中的查询不计入空闲时间，该选项不是查询执行超时。
- 结果保留同名列，PostgreSQL JSON 显示为 JSON 文本，bigint 保留驱动返回的精确字符串，写操作显示影响行数。

这不是完整的 `psql` 或 `mysql` 客户端：不支持 `\d`、`\copy`、`COPY FROM STDIN` 的数据流或 MySQL `DELIMITER` 指令。语句拆分按 PostgreSQL 默认 `standard_conforming_strings` 和 MySQL 默认引号/反斜杠规则处理；更改这些会话规则或复杂 MySQL 存储过程时，使用原生客户端。`query` 的多语句能力由驱动决定，跨数据库脚本统一使用 `shell`。

## 开发验证

```bash
npm run build
npm test -w @hua/plugin-sql
npm run test:integration -w @hua/plugin-sql
```

集成测试需要 PATH 中的 `initdb`、`pg_ctl` 和 `mysqld`；也可通过 `HUA_SQL_TEST_INITDB`、`HUA_SQL_TEST_PG_CTL`、`HUA_SQL_TEST_MYSQLD` 指定路径。测试启动临时本地数据库并通过真实 CLI 验证，使用隔离的 profile 文件，完成后清理，不访问用户的数据库配置。
