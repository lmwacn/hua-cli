import fs from "node:fs";
import path from "node:path";

/**
 * Profile 配置结构
 */
export interface ProfileConfig<T> {
  /** 插件名称，如 "sql", "ssh", "http" */
  name: string;
  /** 拒绝损坏或不支持的配置，避免静默丢弃后覆盖保存。 */
  strictValidation?: boolean;
  /** 通过同目录临时文件替换配置，避免写入失败时损坏原文件。 */
  atomicWrites?: boolean;
  /** 配置文件完整路径 */
  configPath: string;
  /** 验证并规范化 profile，返回 null 表示无效 */
  validateProfile(value: unknown): T | null;
  /** 比较两个 profile 内容是否相同 */
  isProfileEqual(a: T, b: T): boolean;
}

/**
 * 配置文件结构
 */
interface ConfigData<T> {
  defaultProfile?: string;
  profiles: Record<string, T>;
}

/**
 * Profile 列表项
 */
export interface ProfileListItem<T> {
  name: string;
  profile: T;
  isDefault: boolean;
}

/**
 * 重复 profile 查找结果
 */
export interface DuplicateResult<T> {
  name: string;
  profile: T;
}

/**
 * 统一配置管理器
 *
 * 提供配置的读取、写入、验证、重复检查等功能。
 * 所有插件共享同一套配置管理逻辑，避免代码重复。
 */
export class ConfigManager<T> {
  private schema: ProfileConfig<T>;

  constructor(schema: ProfileConfig<T>) {
    this.schema = schema;
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath(): string {
    return this.schema.configPath;
  }

  /**
   * 加载配置
   */
  loadConfig(): ConfigData<T> {
    const configPath = this.schema.configPath;

    if (!fs.existsSync(configPath)) {
      return { profiles: {} };
    }

    const raw = fs.readFileSync(configPath, "utf8");
    if (!raw.trim()) {
      return { profiles: {} };
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.normalizeConfig(parsed);
    } catch (error) {
      if (this.schema.strictValidation) {
        throw new Error(`Invalid ${this.schema.name} configuration: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { profiles: {} };
    }
  }

  /**
   * 保存配置
   */
  saveConfig(config: ConfigData<T>): void {
    const configPath = this.schema.configPath;
    const configDir = path.dirname(configPath);
    fs.mkdirSync(configDir, { recursive: true });
    const contents = `${JSON.stringify(config, null, 2)}\n`;
    if (!this.schema.atomicWrites) {
      fs.writeFileSync(configPath, contents, "utf8");
      return;
    }

    const targetPath = fs.existsSync(configPath) ? fs.realpathSync(configPath) : configPath;
    const tempDir = fs.mkdtempSync(path.join(path.dirname(targetPath), ".config-"));
    try {
      const tempPath = path.join(tempDir, path.basename(configPath));
      fs.writeFileSync(tempPath, contents, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempPath, targetPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * 列出所有 profile
   */
  listProfiles(): ProfileListItem<T>[] {
    const config = this.loadConfig();
    const defaultProfile = config.defaultProfile;
    return Object.entries(config.profiles)
      .map(([name, profile]) => ({
        name,
        profile,
        isDefault: name === defaultProfile,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 添加或更新 profile
   */
  addOrUpdateProfile(name: string, profile: T): void {
    const config = this.loadConfig();
    config.profiles[name] = profile;
    if (!config.defaultProfile) {
      config.defaultProfile = name;
    }
    this.saveConfig(config);
  }

  /**
   * 删除 profile
   */
  removeProfile(name: string): boolean {
    const config = this.loadConfig();
    if (!config.profiles[name]) {
      return false;
    }

    delete config.profiles[name];
    if (config.defaultProfile === name) {
      const remainingNames = Object.keys(config.profiles).sort((a, b) => a.localeCompare(b));
      config.defaultProfile = remainingNames[0];
    }
    this.saveConfig(config);
    return true;
  }

  /**
   * 设置默认 profile
   */
  setDefaultProfile(name: string): boolean {
    const config = this.loadConfig();
    if (!config.profiles[name]) {
      return false;
    }

    config.defaultProfile = name;
    this.saveConfig(config);
    return true;
  }

  /**
   * 获取指定 profile
   */
  getProfile(name: string): T | null {
    const config = this.loadConfig();
    return config.profiles[name] ?? null;
  }

  /**
   * 获取默认 profile 名称
   */
  getDefaultProfileName(): string | null {
    const config = this.loadConfig();
    return config.defaultProfile ?? null;
  }

  /**
   * 解析 profile（如果未指定名称则使用默认）
   */
  resolveProfile(name?: string): { name: string; profile: T } | null {
    const config = this.loadConfig();
    const targetName = name?.trim() || config.defaultProfile;
    if (!targetName) {
      return null;
    }

    const profile = config.profiles[targetName];
    if (!profile) {
      return null;
    }

    return { name: targetName, profile };
  }

  /**
   * 查找内容相同的 profile
   *
   * @param profile 要检查的 profile
   * @returns 如果找到重复，返回 { name, profile }，否则返回 null
   */
  findDuplicateProfile(profile: T): DuplicateResult<T> | null {
    const config = this.loadConfig();
    for (const [name, existing] of Object.entries(config.profiles)) {
      if (this.schema.isProfileEqual(existing, profile)) {
        return { name, profile: existing };
      }
    }
    return null;
  }

  /**
   * 规范化配置
   */
  private normalizeConfig(value: unknown): ConfigData<T> {
    const result: ConfigData<T> = { profiles: {} };

    if (!value || typeof value !== "object") {
      return result;
    }

    const root = value as Record<string, unknown>;

    // 提取 defaultProfile
    if (typeof root.defaultProfile === "string" && root.defaultProfile.trim()) {
      result.defaultProfile = root.defaultProfile.trim();
    }

    // 提取 profiles
    const profiles = root.profiles;
    if (profiles && typeof profiles === "object") {
      for (const [name, profileValue] of Object.entries(profiles as Record<string, unknown>)) {
        const profile = this.schema.validateProfile(profileValue);
        if (profile) {
          result.profiles[name] = profile;
        }
      }
    }

    // 验证 defaultProfile 是否存在
    if (result.defaultProfile && !result.profiles[result.defaultProfile]) {
      delete result.defaultProfile;
    }

    return result;
  }
}
