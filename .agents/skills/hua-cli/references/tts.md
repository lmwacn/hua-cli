# 百炼语音合成与音频生成

两类能力分别使用命令，所有实现统一为 TypeScript，需要 Node.js 18+，无需 Python。

| 能力 | 命令 | 输入 | 模型 |
| --- | --- | --- | --- |
| 语音合成 | `hua tts synthesize` | 稿件、音色 ID、表达指令 | 默认 `qwen-audio-3.1-tts-flash`，另支持 CosyVoice 和旧 Qwen3 HTTP |
| 音频生成 | `hua tts generate` | 场景提示词、可选参考音频 | `qwen-audio-3.1-tts-next` |
| 克隆音色 | `hua tts clone` | 录音样本或已登记音色 | 创建默认 `cosyvoice-v3.5-plus`，支持绑定 Qwen-Audio/CosyVoice 合成模型 |

## 配置与凭据

```bash
export DASHSCOPE_API_KEY=sk-xxx
export SFM_WORKSPACE_ID=<workspace-id>
hua tts config show
hua tts config set --workspace-id <workspace-id> --region cn-beijing
```

两类能力共用 `~/.hua/tts.json`；保存使用权限 `0600`。支持北京 `cn-beijing`、新加坡 `ap-southeast-1`，具体模型是否在该地域可用以百炼官方文档和账号权限为准。API Key 与业务空间必须属于相同地域。

Key 优先级：`--api-key`、指定环境变量、`DASHSCOPE_API_KEY`、配置中的 `apiKey`、旧凭据文件。旧凭据文件继续读取 `~/.hua-voice/config.json`、`~/.hua-avatar/config.json`，Unix 权限须为 `0600`；进程环境变量覆盖旧文件。缺少共用业务空间配置时，读取旧音色注册表的 `service.workspace_id`。

旧 `~/.hua/tts.json` 在读取时转换，不自动改写；执行 `config set` 后保存为 v2。旧 Qwen3 模型仍使用原 HTTP 接口。切换 provider 会同时切换模型和默认音色；自定义音色请显式传 `--voice`。CosyVoice v3.5 无系统音色，必须指定相应模型的复刻或设计音色。

## 语音合成

```bash
hua tts synthesize --file script.txt --instructions "语气温柔、语速稍慢" -o speech.wav
hua tts synthesize "你好" --provider cosyvoice --voice longanyang -o speech.wav
hua tts synthesize "你好" --model cosyvoice-v3.5-plus --voice <voice-id> --format mp3 -o speech.mp3
```

位置文本与 `--file` 互斥。支持 `--language zh`、`--rate 0.8`、`--volume 50`、`--seed`、`--ssml`、`--sample-rate`。不同模型及音色对指令、SSML 的支持以官方文档为准。输出格式支持 WAV、MP3、PCM、Opus，扩展名须一致。旧 Qwen3 HTTP 仅支持默认 WAV，语言值使用 Chinese/English。

## 音频生成

```bash
hua tts generate --file scene.txt -o scene.wav
hua tts generate '@voice1 说：“我们出发吧。”@voice2 回答：“好啊。”背景有海浪声。' --reference person1.wav --reference person2.wav -o scene.wav
hua tts generate --text-file script.txt --style "年轻女声，自然普通话" -o narration.wav
```

输入任选一种：位置提示词、`--file`/`--prompt-file`、`--prompt`、`--text`/`--text-file`。`--style` 用于单人稿件，会构造干声提示词；完整场景提示词直接提交。完整提示词上限 3000 字符。

`--reference` 可重复最多三次，依次对应 `@voice1`、`@voice2`、`@voice3`。支持本地 WAV、MP3、OGG Opus 或公网 HTTP/HTTPS URL。单条参考音频须不超过 30 秒和 10 MB；客户端检查本地文件大小，时长与编码由服务端验证。参考音频通过 URL 或 Base64 提交，不使用 voice ID。

默认 WAV、48 kHz、双声道；支持 MP3、PCM、`--channels 1`、`--rate`、`--volume`、`--seed`。不支持 Opus 输出。播客单次最多 240 秒，其他场景 120 秒。

`--print-url` 只输出下载地址，不保存文件；`--json` 保存音频并打印 API 响应。下载失败会提供恢复 URL，不自动重发合成。URL 含临时访问凭证，不应写入共享日志。两类命令均不自动拆稿或重试计费请求。

`gen`、`next` 分别保留为 `synthesize`、`generate` 的别名。旧 Next 的 `--title`、`--output-root`、`--registry`、`--env-file` 已移除，请改用共用配置和 `-o`。普通合成/生成默认保存当前目录的 `speech.<格式>` / `generated-audio.<格式>`，覆盖前先完整下载并检查文件头。

## 克隆音色

```bash
hua tts clone list
hua tts clone doctor
hua tts clone create --name my-voice --prefix myvoice --audio-file sample.wav --workspace-id <workspace-id>
hua tts clone status --voice my-voice
hua tts clone audio --voice my-voice --text-file script.txt --title "讲解"
```

保留 `~/.hua-voice/voices.json` 注册表格式、旧音色名称和别名；使用 `--registry` 隔离不同业务空间。创建需有用户授权的单人录音和明确创建请求。样本支持非空且不超过 10 MiB 的本地 WAV、MP3、M4A，或 `--audio-url` HTTPS URL。创建与合成使用相同绑定模型。

创建前写入 `submission_unknown` 占位；结果不明时不重发。返回 ID 后先保存，再查询部署状态。音色处于 `DEPLOYING` 时用 `status` 继续查。

```bash
hua tts clone discover --prefix myvoice --page 0
hua tts clone bind --name my-voice --source-json recovered.json
hua tts clone import-avatar /path/old-config.toml
```

远程查询保存到注册表旁 `discovered-*.json`；满 100 条查下一页。核对前缀、创建时间、模型后，将 ID 写入 `{"voice_id":"..."}` 再绑定；已有绑定不覆盖。导入旧 TOML 仅提取百炼音色，不导入头像等资源。克隆配音保留 `Voice/<标题>-<唯一后缀>/` 下的 `script.txt`、音频及 `manifest.json`，失败状态保留为 `failed_or_unknown`。

官方参考：[语音合成](https://help.aliyun.com/zh/model-studio/tts-model)、[音频生成 API](https://help.aliyun.com/zh/model-studio/audio-generation-api)、[音色复刻 API](https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api)。
