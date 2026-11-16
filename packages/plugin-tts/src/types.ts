export type TtsProvider = "qwen-audio" | "qwen" | "cosyvoice";
export type AudioFormat = "wav" | "mp3" | "pcm" | "opus";

export interface SpeechDefaults {
  provider: TtsProvider;
  model: string;
  voice: string;
}

export interface TtsConfig {
  version: 2;
  apiKey?: string;
  apiKeyEnv?: string;
  workspaceId?: string;
  region: string;
  baseUrl?: string;
  timeout: number;
  speech: SpeechDefaults;
}

export interface AudioRequest {
  apiKey: string;
  workspaceId?: string;
  region: string;
  baseUrl?: string;
  timeout: number;
  model: string;
  input: Record<string, unknown>;
  legacyQwen?: boolean;
}

export interface TtsResponse {
  requestId?: string;
  audioUrl: string;
  raw: unknown;
}
