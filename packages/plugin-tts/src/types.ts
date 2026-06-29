export type TtsProvider = "qwen" | "cosyvoice";

export interface TtsConfig {
  apiKey?: string;
  apiKeyEnv?: string;
  provider: TtsProvider;
  model: string;
  voice: string;
  languageType?: string;
  baseUrl?: string;
  workspaceId?: string;
  region?: string;
  format?: string;
  sampleRate?: number;
  timeout?: number;
}

export interface TtsRequestOptions {
  apiKey: string;
  provider: TtsProvider;
  model: string;
  voice: string;
  text: string;
  languageType?: string;
  instructions?: string;
  optimizeInstructions?: boolean;
  baseUrl?: string;
  workspaceId?: string;
  region?: string;
  format?: string;
  sampleRate?: number;
  ssml?: boolean;
  timeout: number;
}

export interface TtsResponse {
  requestId?: string;
  audioUrl: string;
  raw: unknown;
}
