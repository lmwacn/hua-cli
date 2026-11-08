# 百炼语音

- `hua tts gen` 使用已有的 Qwen 或 CosyVoice 配置，默认读取 `~/.hua/tts.json`。具体参数见 `hua tts gen --help`。
- `hua tts next` 用 `qwen-audio-3.1-tts-next` 根据文字描述生成单人干声，输入 `--text` 或 `--text-file`，用 `--style` 指定音色、语气及节奏。用 `--prompt` 或 `--prompt-file` 提交完整声景描述，可一次生成旁白、背景音乐和环境音。
- `hua tts clone` 管理百炼克隆音色。先用 `list` 查名称，`status --voice <name>` 查部署状态，`audio --voice <name> --text-file <file>` 合成。新建用 `create`，恢复用 `discover` 和 `bind`，导入旧头像配置用 `import-avatar`。

```bash
hua tts next --text-file script.txt --style "年轻成年女性，自然普通话，声音清甜，像在和朋友聊天" --title "AI 讲解"
hua tts next --prompt '清甜女声说：“我们先看 API 文档。”配低音量 lo-fi 音乐，开头有轻微键盘声。' --title "科技旁白"
hua tts clone audio --voice da-tie-chui --text-file script.txt --title "AI 讲解"
hua tts clone create --name my-voice --prefix myvoice --audio-file sample.wav --workspace-id <workspace-id>
```

四种 Next 输入选项互斥。声景模式把完整提示词直接交给模型，输出 48 kHz 立体声混合音轨，并保存 `prompt.txt`。请在提示词里写清要逐字读出的台词、音乐音量和音效出现时机。纯配音模式输出 24 kHz 单声道，保存 `script.txt`。

Next 和 clone 需要 Python 3.11+。默认复用北京地域注册表 `~/.hua-voice/voices.json` 及环境变量 `DASHSCOPE_API_KEY`、`~/.hua-voice/config.json` 或 `~/.hua-avatar/config.json`。本地凭据文件在 Unix 上须为 `0600`。可用 `--registry`、`--env-file` 指定替代文件。Next 可用 `--workspace-id` 指定业务空间。用 `hua tts clone doctor` 检查本地配置。

凭据优先级从高到低为进程环境变量、`--env-file`、`~/.hua-voice/config.json`、`~/.hua-avatar/config.json`。切换业务空间时用独立注册表，避免混用不同空间的克隆音色。

克隆需有用户授权的单人录音和明确的创建请求。建议使用 10–30 秒干净的单人录音。客户端支持 10 MiB 以内的 WAV、MP3、M4A 文件，或通过 `--audio-url` 提供 HTTPS URL。保留用户原始样本，创建与合成使用相同的绑定模型。

新音色处于 `DEPLOYING` 时用 `status` 继续查询。创建提交前会写入 `submission_unknown` 占位，结果不明时不要重发创建或合成。有音色 ID 时先查询状态。缺少 ID 时，从第 0 页按创建时的前缀查询，并用创建时间和目标模型确认对应资源。确认后，将 ID 写入临时 JSON 再绑定已有占位。

```bash
hua tts clone discover --prefix myvoice --page 0
hua tts clone bind --name my-voice --source-json /path/recovered.json
```

查询结果保存在注册表旁的 `discovered-*.json`。满 100 条时查下一页。绑定输入为 `{"voice_id":"..."}`，已有绑定不能覆盖。无法确认对应资源时保留占位，等核实后再绑定。

两种配音默认写入 `Voice/<标题>-<唯一后缀>/`，保存原文、状态和 WAV，可用 `--format mp3` 或 `--output-root` 改输出。Next 的风格和稿件合计受 3000 字符提示词限制。完成后用绝对路径嵌入音频并提供文件链接。
