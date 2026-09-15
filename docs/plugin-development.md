# 插件开发规范

本文档约定 `hua-cli` 的插件编写方式、目录建议和设计边界。

## 目标

- 让插件可以独立开发和维护
- 保持 `core` 与业务插件解耦
- 让命令定义、业务逻辑和底层依赖分层清晰

## 插件接口

当前插件接口定义位于 `packages/plugin-sdk/src/index.ts`。

核心接口如下：

```ts
export interface CommandContext {
  args: string[];
  options: Record<string, unknown>;
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface HuaCommand {
  name: string;
  description: string;
  parentPath?: string[];
  aliases?: string[];
  arguments?: string[];
  options?: CommandOption[];
  action: (context: CommandContext) => Promise<void> | void;
}

export interface HuaPlugin {
  name: string;
  description: string;
  commands: HuaCommand[];
}
```

## 最小插件示例

```ts
import { definePlugin } from "@hua/plugin-sdk";

export const demoPlugin = definePlugin({
  name: "demo",
  description: "demo plugin",
  commands: [
    {
      parentPath: ["profile"],
      name: "list",
      description: "list profiles",
      async action(context) {
        context.log("profile list");
      },
    },
    {
      name: "echo <message>",
      description: "print message",
      async action(context) {
        context.log(String(context.args[0] ?? ""));
      },
    },
  ],
});
```

## 推荐目录结构

推荐每个插件使用如下结构：

```text
plugin-xxx/
  src/
    index.ts          # 插件导出
    commands/         # 命令入口
    services/         # 业务逻辑
    drivers/          # 第三方 SDK、数据库、网络访问封装
    config/           # 配置结构与校验
    formatters/       # 输出格式转换
    types/            # 插件内部类型
```

## 编写规范

### 1. 单一职责

- `commands` 只负责命令参数解析和调用
- `services` 只负责业务流程
- `drivers` 只负责与外部系统交互
- `formatters` 只负责输出格式化

### 2. 不污染核心层

- `core` 不应直接依赖某个业务插件
- 插件内部可以依赖 `plugin-sdk`
- 插件之间默认不要直接互相依赖

### 3. 输出统一

- 正常信息使用 `context.log`
- 错误信息使用 `context.error`
- 避免在插件里直接散落 `console.log`

### 4. 命令命名

- 一级命令名由插件名提供，例如 `sql`
- 建议优先使用嵌套命令，例如 `parentPath: ["profile"] + name: "add"`，最终命令为 `sql profile add`
- 别名仅作为兼容或快捷方式使用

### 5. 错误处理

- 对输入参数做最小校验
- 对外部依赖错误做友好提示
- 不在 `action` 内吞掉所有异常

### 6. 可扩展性

- 不要把所有逻辑堆进一个 `index.ts`
- 为未来新增子命令和驱动预留分层空间

## 注册方式

插件由 CLI 入口显式注册：

```ts
import { HuaCliApp } from "@hua/core";
import { sqlPlugin } from "@hua/plugin-sql";

const app = new HuaCliApp();
app.registerPlugin(sqlPlugin);
```

当前约定：

- 第一阶段使用显式注册
- 暂不做自动扫描本地目录
- 暂不做外部插件市场和远程安装

## SQL 插件结构

`sql` 统一命令和 profile 管理，通过驱动适配 MySQL 与 PostgreSQL，不转换 SQL 方言：

```text
src/
  index.ts            # 命令参数与调用
  profile-store.ts    # driver、连接配置与兼容校验
  shell.ts            # 同一连接串行执行、超时与退出
  statements.ts       # 按方言识别语句边界
  format-results.ts   # 统一表格输出
  drivers/
    types.ts          # 连接与结果接口
    index.ts          # 根据 driver 选择实现
    mysql.ts
    postgres.ts
```

新增驱动时复用命令层，明确其默认端口、结果类型和语句边界规则，并增加连接及事务集成测试。

## 新插件接入步骤

1. 在 `packages/` 下创建新插件包
2. 编写该插件的 `package.json` 与 `tsconfig.json`
3. 在 `src/index.ts` 中导出 `definePlugin(...)`
4. 在 `packages/cli/src/index.ts` 中注册该插件
5. 执行 `npm run build`
6. 使用 `hua <plugin-name> --help` 验证

## 质量建议

- 先保证 `--help` 输出清晰
- 为关键命令增加最小冒烟测试
- 新增命令时同步更新 `README.md`
- 对外部连接类插件优先补错误提示与配置校验
