import { spawnSync } from "node:child_process";
import path from "node:path";
import type { HuaCommand } from "@hua/plugin-sdk";

const commands = [
  { name: "next", description: "Generate narration or a mixed soundscape with Qwen-Audio 3.1 TTS Next", flags: [
    "text", "text-file", "prompt", "prompt-file", "style", "title", "format", "output-root", "workspace-id",
  ] },
  { name: "list", description: "List registered clone voices", flags: [] },
  { name: "doctor", description: "Check local clone voice configuration", flags: [] },
  { name: "import-avatar", description: "Import existing avatar voices locally", flags: [], arguments: ["<source>"] },
  { name: "create", description: "Create a clone voice from an audio sample", flags: [
    "name", "display-name", "prefix", "model", "workspace-id", "audio-file", "audio-url", "wait",
  ] },
  { name: "status", description: "Check clone voice status", flags: ["voice", "wait"] },
  { name: "audio", description: "Generate audio with a registered clone voice", flags: [
    "voice", "text", "text-file", "title", "format", "output-root",
  ] },
  { name: "discover", description: "Find clone voices by prefix", flags: ["prefix", "page"] },
  { name: "bind", description: "Bind a recovered voice ID from a JSON file", flags: ["name", "source-json"] },
];

export const voiceCommands: HuaCommand[] = commands.map(({ name, description, flags, arguments: args }) => ({
  name,
  description,
  parentPath: name === "next" ? [] : ["clone"],
  arguments: args,
  options: [...flags, "registry", "env-file"].map(flag => ({
    flags: `--${flag} <value>`,
    description: flag.replace(/-/g, " "),
  })),
  action(context) {
    const readFlags = (keys: string[]) => keys.flatMap(key => {
      const camelKey = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      const value = context.options[camelKey];
      return typeof value === "string" ? [`--${key}=${value}`] : [];
    });

    const script = path.join(__dirname, "../clone/voice.py");
    for (const python of ["python3", "python3.14", "python3.13", "python3.12", "python3.11"]) {
      const check = spawnSync(python, ["-c", "import sys; sys.exit(sys.version_info < (3, 11))"]);
      if (check.status !== 0) continue;
      const result = spawnSync(python, [
        "-B", script, ...readFlags(["registry", "env-file"]), name, ...readFlags(flags), ...context.args,
      ], { stdio: "inherit" });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
      return;
    }
    throw new Error("语音克隆需要 Python 3.11 或更高版本");
  },
}));
