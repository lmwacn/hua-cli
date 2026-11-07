from __future__ import annotations

from .errors import ApiError
from .http import HttpClient


NEXT_MODEL = "qwen-audio-3.1-tts-next"


class BailianClient:
    def __init__(self, *, workspace_id: str, region: str, api_key: str, http: HttpClient | None = None):
        if region != "cn-beijing":
            raise ApiError(f"当前版本只配置了北京地域：{region}")
        self.workspace_id = workspace_id
        self.region = region
        self.api_key = api_key
        self.http = http or HttpClient(timeout=300)
        self.base_url = f"https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts"

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    def query_voice(self, voice_id: str) -> dict:
        response = self.http.json_request(
            "POST",
            f"{self.base_url}/customization",
            headers=self.headers,
            payload={
                "model": "voice-enrollment",
                "input": {"action": "query_voice", "voice_id": voice_id},
            },
        )
        return response.get("output") or {}

    def synthesize(
        self,
        *,
        text: str,
        voice_id: str,
        model: str,
        audio_format: str = "wav",
        bit_rate: int | None = None,
    ) -> dict:
        audio_input = {
            "text": text,
            "voice": voice_id,
            "format": audio_format,
            "sample_rate": 24000,
        }
        if bit_rate is not None:
            audio_input["bit_rate"] = bit_rate
        return self._synthesize(model, audio_input)

    def synthesize_next(self, *, prompt: str, audio_format: str) -> dict:
        return self._synthesize(NEXT_MODEL, {
            "text_prompt": prompt, "format": audio_format, "sample_rate": 24000, "channels": 1,
        })

    def _synthesize(self, model: str, audio_input: dict) -> dict:
        response = self.http.json_request(
            "POST",
            f"{self.base_url}/SpeechSynthesizer",
            headers=self.headers,
            payload={
                "model": model,
                "input": audio_input,
            },
        )
        output = response.get("output") or {}
        audio = output.get("audio") or {}
        if not audio.get("url"):
            raise ApiError("百炼语音合成未返回 output.audio.url", detail=response)
        return {
            "url": audio["url"],
            "audio_id": audio.get("id"),
            "expires_at": audio.get("expires_at"),
            "characters": (response.get("usage") or {}).get("characters"),
            "request_id": response.get("request_id"),
        }
