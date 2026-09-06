import path from "node:path";
import { definePlugin, type CommandContext, type CommandOption, type HuaCommand } from "@hua/plugin-sdk";
import { createSdk } from "./driver";
import { createBucket, deleteBucket, getBucketInfo, listBucketDomains, listBuckets } from "./bucket-service";
import {
  copyObject,
  deleteObject,
  downloadObject,
  listObjects,
  moveObject,
  resolveObjectUrl,
  statObject,
  uploadObject,
} from "./object-service";
import {
  addOrUpdateProfile,
  getConfigPath,
  getProfile,
  listProfiles,
  maskSecret,
  removeProfile,
  resolveCredentials,
  setDefaultProfile,
} from "./profile-store";
import { formatBytes, formatPutTime, formatTable, storageTypeName } from "./formatter";
import {
  DOMAIN_CONFIG_SECTIONS,
  changeCdnDomainState,
  createCdnDomain,
  deleteCdnDomain,
  getCdnBandwidth,
  getCdnDomain,
  getCdnLogs,
  getCdnTraffic,
  listCdnDomains,
  prefetchCdnUrls,
  readJsonConfig,
  redactSensitive,
  refreshCdnDirs,
  refreshCdnUrls,
  updateCdnDomainConfig,
  validateDate,
  validateGranularity,
  validateHttpUrls,
  type DomainConfigSection,
} from "./cdn-service";
import type { QiniuProfile } from "./types";

const profileOption: CommandOption = {
  flags: "-p, --profile <name>",
  description: "Qiniu profile name (default: active profile)",
};

function stringOption(context: CommandContext, key: string): string {
  const value = context.options[key];
  return typeof value === "string" ? value.trim() : value === undefined ? "" : String(value).trim();
}

function booleanOption(context: CommandContext, key: string): boolean {
  return context.options[key] === true;
}

function integerOption(context: CommandContext, key: string, fallback: number, minimum = 1, maximum = 10_000): number {
  const value = Number.parseInt(stringOption(context, key) || String(fallback), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function getSdk(context: CommandContext) {
  const resolved = resolveCredentials(stringOption(context, "profile"));
  return { ...resolved, sdk: createSdk(resolved.credentials) };
}

function safeProfile(profile: QiniuProfile): Record<string, unknown> {
  return {
    accessKey: maskSecret(profile.accessKey),
    secretKey: maskSecret(profile.secretKey),
    accessKeyEnv: profile.accessKeyEnv,
    secretKeyEnv: profile.secretKeyEnv,
    regionId: profile.regionId,
    defaultBucket: profile.defaultBucket,
    defaultDomain: profile.defaultDomain,
  };
}

function safeBucketInfo(info: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...info };
  for (const key of ["mac_key", "mac_key2", "accessKey", "secretKey"]) {
    if (key in safe) safe[key] = "***";
  }
  return safe;
}

function requireConfirmation(context: CommandContext, action: string): void {
  if (!booleanOption(context, "yes")) throw new Error(`Refusing to ${action} without --yes.`);
}

function validateDateRange(from: string, to: string): void {
  if (from > to) throw new Error("--from must not be later than --to.");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > 30) throw new Error("CDN statistics date range cannot exceed 31 calendar days.");
}

function validateBatchSize(values: string[], maximum: number, label: string): void {
  if (values.length > maximum) throw new Error(`A single ${label} request supports at most ${maximum} entries.`);
}

const commands: HuaCommand[] = [
  {
    parentPath: ["profile"],
    name: "add",
    description: "Add or update a Qiniu credential profile",
    arguments: ["<name>"],
    options: [
      { flags: "--access-key <key>", description: "Access key to store locally" },
      { flags: "--secret-key <key>", description: "Secret key to store locally (prefer --secret-key-env)" },
      { flags: "--access-key-env <name>", description: "Environment variable containing the access key" },
      { flags: "--secret-key-env <name>", description: "Environment variable containing the secret key" },
      { flags: "--region <id>", description: "Default region ID, for example z0" },
      { flags: "--bucket <name>", description: "Default bucket name" },
      { flags: "--domain <domain>", description: "Default bucket domain" },
    ],
    action(context) {
      const name = context.args[0]?.trim();
      if (!name) throw new Error("Profile name is required.");
      const accessKey = stringOption(context, "accessKey") || undefined;
      const secretKey = stringOption(context, "secretKey") || undefined;
      const profile: QiniuProfile = {
        accessKey,
        secretKey,
        accessKeyEnv: accessKey ? undefined : stringOption(context, "accessKeyEnv") || "QINIU_ACCESS_KEY",
        secretKeyEnv: secretKey ? undefined : stringOption(context, "secretKeyEnv") || "QINIU_SECRET_KEY",
        regionId: stringOption(context, "region") || undefined,
        defaultBucket: stringOption(context, "bucket") || undefined,
        defaultDomain: stringOption(context, "domain") || undefined,
      };
      addOrUpdateProfile(name, profile);
      context.log(`Saved Qiniu profile '${name}' to ${getConfigPath()} (mode 0600).`);
      if (!accessKey || !secretKey) {
        context.log(`Credential values will be read from ${profile.accessKeyEnv} and ${profile.secretKeyEnv}.`);
      }
    },
  },
  {
    parentPath: ["profile"],
    name: "list",
    description: "List Qiniu profiles",
    options: [{ flags: "--json", description: "Output JSON" }],
    action(context) {
      const profiles = listProfiles();
      if (booleanOption(context, "json")) {
        context.log(JSON.stringify(profiles.map((item) => ({ ...item, profile: safeProfile(item.profile) })), null, 2));
        return;
      }
      if (!profiles.length) {
        context.log("No Qiniu profiles configured.");
        return;
      }
      context.log(formatTable(
        ["NAME", "DEFAULT", "ACCESS KEY", "SECRET KEY", "REGION"],
        profiles.map(({ name, profile, isDefault }) => [
          name,
          isDefault ? "yes" : "",
          profile.accessKeyEnv ? `env:${profile.accessKeyEnv}` : maskSecret(profile.accessKey),
          profile.secretKeyEnv ? `env:${profile.secretKeyEnv}` : maskSecret(profile.secretKey),
          profile.regionId ?? "auto",
        ]),
      ));
    },
  },
  {
    parentPath: ["profile"],
    name: "show",
    description: "Show a Qiniu profile without exposing secrets",
    arguments: ["[name]"],
    action(context) {
      const resolved = getProfile(context.args[0]);
      if (!resolved) throw new Error("Qiniu profile not found.");
      context.log(JSON.stringify({ name: resolved.name, ...safeProfile(resolved.profile) }, null, 2));
    },
  },
  {
    parentPath: ["profile"],
    name: "use",
    description: "Set the default Qiniu profile",
    arguments: ["<name>"],
    action(context) {
      const name = context.args[0]?.trim();
      if (!name || !setDefaultProfile(name)) throw new Error(`Qiniu profile '${name ?? ""}' not found.`);
      context.log(`Default Qiniu profile set to '${name}'.`);
    },
  },
  {
    parentPath: ["profile"],
    name: "remove",
    description: "Remove a Qiniu profile",
    arguments: ["<name>"],
    action(context) {
      const name = context.args[0]?.trim();
      if (!name || !removeProfile(name)) throw new Error(`Qiniu profile '${name ?? ""}' not found.`);
      context.log(`Removed Qiniu profile '${name}'.`);
    },
  },
  {
    parentPath: ["profile"],
    name: "test",
    description: "Verify profile credentials by listing buckets",
    options: [profileOption],
    async action(context) {
      const { name, sdk } = getSdk(context);
      const buckets = await listBuckets(sdk);
      context.log(`Qiniu profile '${name}' is valid (${buckets.length} bucket(s) visible).`);
    },
  },
  {
    parentPath: ["bucket"],
    name: "list",
    description: "List buckets",
    options: [profileOption, { flags: "--json", description: "Output JSON" }],
    async action(context) {
      const buckets = await listBuckets(getSdk(context).sdk);
      context.log(booleanOption(context, "json") ? JSON.stringify(buckets, null, 2) : buckets.join("\n") || "No buckets found.");
    },
  },
  {
    parentPath: ["bucket"],
    name: "info",
    description: "Show bucket details",
    arguments: ["<bucket>"],
    options: [profileOption],
    async action(context) {
      const info = await getBucketInfo(getSdk(context).sdk, context.args[0]);
      context.log(JSON.stringify(safeBucketInfo(info), null, 2));
    },
  },
  {
    parentPath: ["bucket"],
    name: "domains",
    description: "List domains bound to a bucket",
    arguments: ["<bucket>"],
    options: [profileOption, { flags: "--json", description: "Output JSON" }],
    async action(context) {
      const domains = await listBucketDomains(getSdk(context).sdk, context.args[0]);
      if (booleanOption(context, "json")) context.log(JSON.stringify(domains, null, 2));
      else context.log(domains.map((item) => String(item.domain ?? "")).filter(Boolean).join("\n") || "No domains found.");
    },
  },
  {
    parentPath: ["bucket"],
    name: "create",
    description: "Create a bucket",
    arguments: ["<bucket>"],
    options: [profileOption, { flags: "--region <id>", description: "Required region ID, for example z0" }],
    async action(context) {
      const { sdk, credentials } = getSdk(context);
      const region = stringOption(context, "region") || credentials.regionId;
      if (!region) throw new Error("Bucket region is required. Pass --region <id> or configure it in the profile.");
      await createBucket(sdk, context.args[0], region);
      context.log(`Created bucket '${context.args[0]}' in region '${region}'.`);
    },
  },
  {
    parentPath: ["bucket"],
    name: "delete",
    description: "Delete an empty bucket",
    arguments: ["<bucket>"],
    options: [profileOption, { flags: "--yes", description: "Confirm destructive deletion" }],
    async action(context) {
      if (!booleanOption(context, "yes")) throw new Error("Refusing to delete bucket without --yes.");
      await deleteBucket(getSdk(context).sdk, context.args[0]);
      context.log(`Deleted bucket '${context.args[0]}'.`);
    },
  },
  {
    parentPath: ["object"],
    name: "list",
    description: "List objects with marker pagination",
    arguments: ["<bucket>"],
    options: [
      profileOption,
      { flags: "--prefix <prefix>", description: "Only list keys with this prefix" },
      { flags: "--delimiter <value>", description: "Group keys by delimiter, usually /" },
      { flags: "--marker <marker>", description: "Continue from a previous marker" },
      { flags: "--limit <number>", description: "Maximum objects to return (1-10000)", defaultValue: 100 },
      { flags: "--json", description: "Output JSON" },
    ],
    async action(context) {
      const result = await listObjects(getSdk(context).sdk, context.args[0], {
        prefix: stringOption(context, "prefix") || undefined,
        delimiter: stringOption(context, "delimiter") || undefined,
        marker: stringOption(context, "marker") || undefined,
        limit: integerOption(context, "limit", 100),
      });
      if (booleanOption(context, "json")) {
        context.log(JSON.stringify(result, null, 2));
        return;
      }
      const rows = result.items.map((item) => [
        item.key,
        formatBytes(item.size),
        item.mimeType,
        storageTypeName(item.storageType),
        formatPutTime(item.putTime),
      ]);
      context.log(rows.length ? formatTable(["KEY", "SIZE", "MIME", "STORAGE", "UPLOADED"], rows) : "No objects found.");
      for (const prefix of result.commonPrefixes) context.log(`[prefix] ${prefix}`);
      if (result.nextMarker) context.log(`Next marker: ${result.nextMarker}`);
    },
  },
  {
    parentPath: ["object"],
    name: "stat",
    description: "Show object metadata",
    arguments: ["<bucket>", "<key>"],
    options: [profileOption],
    async action(context) {
      context.log(JSON.stringify(await statObject(getSdk(context).sdk, context.args[0], context.args[1]), null, 2));
    },
  },
  {
    parentPath: ["object"],
    name: "upload",
    description: "Upload a local file with resumable upload v2",
    arguments: ["<bucket>", "<local-path>"],
    options: [
      profileOption,
      { flags: "--key <key>", description: "Remote object key (default: local file name)" },
      { flags: "--force", description: "Allow overwriting an existing object" },
      { flags: "--json", description: "Output JSON" },
    ],
    async action(context) {
      const { sdk } = getSdk(context);
      const key = stringOption(context, "key") || path.basename(context.args[1]);
      const result = await uploadObject(sdk, context.args[0], context.args[1], key, booleanOption(context, "force"));
      context.log(booleanOption(context, "json") ? JSON.stringify(result, null, 2) : `Uploaded '${context.args[1]}' to '${context.args[0]}:${key}'.`);
    },
  },
  {
    parentPath: ["object"],
    name: "url",
    description: "Generate an object download URL",
    arguments: ["<bucket>", "<key>"],
    options: [
      profileOption,
      { flags: "--domain <domain>", description: "Bucket domain (auto-detected when omitted)" },
      { flags: "--expires <seconds>", description: "Private URL validity in seconds", defaultValue: 3600 },
    ],
    async action(context) {
      const { sdk, credentials } = getSdk(context);
      const url = await resolveObjectUrl(
        sdk,
        context.args[0],
        context.args[1],
        stringOption(context, "domain") || credentials.defaultDomain,
        integerOption(context, "expires", 3600, 1, 604_800),
      );
      context.log(url);
    },
  },
  {
    parentPath: ["object"],
    name: "download",
    description: "Download an object",
    arguments: ["<bucket>", "<key>"],
    options: [
      profileOption,
      { flags: "-o, --output <path>", description: "Output path (default: object file name)" },
      { flags: "--domain <domain>", description: "Bucket domain (auto-detected when omitted)" },
      { flags: "--expires <seconds>", description: "Private URL validity in seconds", defaultValue: 3600 },
      { flags: "--force", description: "Overwrite an existing local file" },
    ],
    async action(context) {
      const { sdk, credentials } = getSdk(context);
      const key = context.args[1];
      const url = await resolveObjectUrl(
        sdk,
        context.args[0],
        key,
        stringOption(context, "domain") || credentials.defaultDomain,
        integerOption(context, "expires", 3600, 1, 604_800),
      );
      const output = stringOption(context, "output") || path.basename(key) || "download";
      context.log(`Downloaded to ${await downloadObject(url, output, booleanOption(context, "force"))}`);
    },
  },
  {
    parentPath: ["object"],
    name: "copy",
    description: "Copy an object",
    arguments: ["<source-bucket>", "<source-key>", "<target-bucket>", "<target-key>"],
    options: [profileOption, { flags: "--force", description: "Overwrite the target object" }],
    async action(context) {
      await copyObject(getSdk(context).sdk, context.args[0], context.args[1], context.args[2], context.args[3], booleanOption(context, "force"));
      context.log(`Copied '${context.args[0]}:${context.args[1]}' to '${context.args[2]}:${context.args[3]}'.`);
    },
  },
  {
    parentPath: ["object"],
    name: "move",
    description: "Move or rename an object",
    arguments: ["<source-bucket>", "<source-key>", "<target-bucket>", "<target-key>"],
    options: [profileOption, { flags: "--force", description: "Overwrite the target object" }],
    async action(context) {
      await moveObject(getSdk(context).sdk, context.args[0], context.args[1], context.args[2], context.args[3], booleanOption(context, "force"));
      context.log(`Moved '${context.args[0]}:${context.args[1]}' to '${context.args[2]}:${context.args[3]}'.`);
    },
  },
  {
    parentPath: ["object"],
    name: "delete",
    description: "Delete an object",
    arguments: ["<bucket>", "<key>"],
    options: [profileOption, { flags: "--yes", description: "Confirm destructive deletion" }],
    async action(context) {
      if (!booleanOption(context, "yes")) throw new Error("Refusing to delete object without --yes.");
      await deleteObject(getSdk(context).sdk, context.args[0], context.args[1]);
      context.log(`Deleted '${context.args[0]}:${context.args[1]}'.`);
    },
  },
  {
    parentPath: ["cdn", "domain"],
    name: "list",
    description: "List CDN domains",
    options: [
      profileOption,
      { flags: "--limit <number>", description: "Maximum domains to return (1-10000)", defaultValue: 100 },
      { flags: "--marker <marker>", description: "Continue from a previous marker" },
      { flags: "--type <type>", description: "Filter by domain type: normal, wildcard, pan, or test" },
      { flags: "--bucket <bucket>", description: "Filter by Qiniu bucket origin" },
      { flags: "--json", description: "Output JSON" },
    ],
    async action(context) {
      const type = stringOption(context, "type") || undefined;
      if (type && !["normal", "wildcard", "pan", "test"].includes(type)) {
        throw new Error("--type must be one of: normal, wildcard, pan, test.");
      }
      const result = await listCdnDomains(getSdk(context).sdk, {
        limit: integerOption(context, "limit", 100),
        marker: stringOption(context, "marker") || undefined,
        type,
        sourceBucket: stringOption(context, "bucket") || undefined,
      });
      if (booleanOption(context, "json")) {
        context.log(JSON.stringify(redactSensitive(result), null, 2));
        return;
      }
      const rows = result.domains.map((domain) => [
        String(domain.name ?? ""),
        String(domain.cname ?? ""),
        String(domain.protocol ?? ""),
        String(domain.geoCover ?? ""),
        String(domain.operatingState ?? ""),
      ]);
      context.log(rows.length
        ? formatTable(["DOMAIN", "CNAME", "PROTOCOL", "AREA", "STATE"], rows)
        : "No CDN domains found.");
      if (result.nextMarker) context.log(`Next marker: ${result.nextMarker}`);
    },
  },
  {
    parentPath: ["cdn", "domain"],
    name: "info",
    description: "Show CDN domain details",
    arguments: ["<domain>"],
    options: [profileOption],
    async action(context) {
      const result = await getCdnDomain(getSdk(context).sdk, context.args[0]);
      context.log(JSON.stringify(redactSensitive(result), null, 2));
    },
  },
  {
    parentPath: ["cdn", "domain"],
    name: "create",
    description: "Create a CDN domain from a JSON configuration file",
    arguments: ["<domain>"],
    options: [
      profileOption,
      { flags: "--config <path>", description: "JSON file containing the official domain creation request" },
      { flags: "--yes", description: "Confirm domain creation" },
    ],
    async action(context) {
      requireConfirmation(context, "create CDN domain");
      const configPath = stringOption(context, "config");
      if (!configPath) throw new Error("--config <path> is required.");
      await createCdnDomain(getSdk(context).sdk, context.args[0], readJsonConfig(configPath));
      context.log(`CDN domain '${context.args[0]}' creation submitted.`);
    },
  },
  {
    parentPath: ["cdn", "domain"],
    name: "update",
    description: "Update one CDN domain configuration section from JSON",
    arguments: ["<domain>", "<section>"],
    options: [
      profileOption,
      { flags: "--config <path>", description: "JSON file containing the official section request" },
      { flags: "--yes", description: "Confirm configuration update" },
    ],
    async action(context) {
      requireConfirmation(context, "update CDN domain configuration");
      const section = context.args[1] as DomainConfigSection;
      if (!DOMAIN_CONFIG_SECTIONS.includes(section)) {
        throw new Error(`Unsupported section '${context.args[1]}'. Use one of: ${DOMAIN_CONFIG_SECTIONS.join(", ")}.`);
      }
      const configPath = stringOption(context, "config");
      if (!configPath) throw new Error("--config <path> is required.");
      await updateCdnDomainConfig(getSdk(context).sdk, context.args[0], section, readJsonConfig(configPath));
      context.log(`CDN domain '${context.args[0]}' section '${section}' update submitted.`);
    },
  },
  ...(["online", "offline"] as const).map((state): HuaCommand => ({
    parentPath: ["cdn", "domain"],
    name: state,
    description: `${state === "online" ? "Enable" : "Disable"} a CDN domain`,
    arguments: ["<domain>"],
    options: [profileOption, { flags: "--yes", description: `Confirm domain ${state}` }],
    async action(context) {
      requireConfirmation(context, `set CDN domain ${state}`);
      await changeCdnDomainState(getSdk(context).sdk, context.args[0], state);
      context.log(`CDN domain '${context.args[0]}' ${state} request submitted.`);
    },
  })),
  {
    parentPath: ["cdn", "domain"],
    name: "delete",
    description: "Delete an offline CDN domain",
    arguments: ["<domain>"],
    options: [profileOption, { flags: "--yes", description: "Confirm destructive deletion" }],
    async action(context) {
      requireConfirmation(context, "delete CDN domain");
      await deleteCdnDomain(getSdk(context).sdk, context.args[0]);
      context.log(`CDN domain '${context.args[0]}' deletion submitted.`);
    },
  },
  {
    parentPath: ["cdn"],
    name: "refresh-url",
    description: "Refresh CDN URL cache",
    arguments: ["<urls...>"],
    options: [profileOption, { flags: "--json", description: "Output JSON" }],
    async action(context) {
      const urls = validateHttpUrls(context.args, "url");
      validateBatchSize(urls, 20, "URL refresh");
      const result = await refreshCdnUrls(getSdk(context).sdk, urls);
      context.log(booleanOption(context, "json") ? JSON.stringify(result, null, 2) : `Submitted ${urls.length} CDN URL refresh(es).`);
    },
  },
  {
    parentPath: ["cdn"],
    name: "refresh-dir",
    description: "Refresh CDN directory cache",
    arguments: ["<directories...>"],
    options: [profileOption, { flags: "--json", description: "Output JSON" }],
    async action(context) {
      const directories = validateHttpUrls(context.args, "directory");
      validateBatchSize(directories, 10, "directory refresh");
      const result = await refreshCdnDirs(getSdk(context).sdk, directories);
      context.log(booleanOption(context, "json") ? JSON.stringify(result, null, 2) : `Submitted ${directories.length} CDN directory refresh(es).`);
    },
  },
  {
    parentPath: ["cdn"],
    name: "prefetch",
    description: "Prefetch URLs to CDN nodes",
    arguments: ["<urls...>"],
    options: [profileOption, { flags: "--json", description: "Output JSON" }],
    async action(context) {
      const urls = validateHttpUrls(context.args, "url");
      validateBatchSize(urls, 100, "URL prefetch");
      const result = await prefetchCdnUrls(getSdk(context).sdk, urls);
      context.log(booleanOption(context, "json") ? JSON.stringify(result, null, 2) : `Submitted ${urls.length} CDN URL prefetch(es).`);
    },
  },
  ...(["traffic", "bandwidth"] as const).map((metric): HuaCommand => ({
    parentPath: ["cdn"],
    name: metric,
    description: `Query CDN ${metric}`,
    arguments: ["<domain>"],
    options: [
      profileOption,
      { flags: "--from <date>", description: "Start date in YYYY-MM-DD format" },
      { flags: "--to <date>", description: "End date in YYYY-MM-DD format" },
      { flags: "--granularity <value>", description: "5min, hour, or day", defaultValue: "day" },
    ],
    async action(context) {
      const from = validateDate(stringOption(context, "from"), "--from");
      const to = validateDate(stringOption(context, "to"), "--to");
      validateDateRange(from, to);
      const granularity = validateGranularity(stringOption(context, "granularity") || "day");
      const sdk = getSdk(context).sdk;
      const result = metric === "traffic"
        ? await getCdnTraffic(sdk, context.args[0], from, to, granularity)
        : await getCdnBandwidth(sdk, context.args[0], from, to, granularity);
      context.log(JSON.stringify(result, null, 2));
    },
  })),
  {
    parentPath: ["cdn"],
    name: "logs",
    description: "Get CDN access log download links",
    arguments: ["<domain>"],
    options: [profileOption, { flags: "--date <date>", description: "Log date in YYYY-MM-DD format" }],
    async action(context) {
      const date = validateDate(stringOption(context, "date"), "--date");
      const result = await getCdnLogs(getSdk(context).sdk, context.args[0], date);
      context.log(JSON.stringify(result, null, 2));
    },
  },
];

export const qiniuPlugin = definePlugin({
  name: "qiniu",
  description: "Qiniu Kodo and CDN management",
  commands,
});
