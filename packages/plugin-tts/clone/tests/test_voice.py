import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import voice


class FakeHTTP:
    def __init__(self, output=None):
        self.output = output or {'voice_id': 'new-id'}
        self.calls = []

    def json_request(self, method, url, **kw):
        self.calls.append(kw['payload'])
        return {'output': self.output}

    def download(self, url, destination):
        with wave.open(str(destination), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(b'\x00\x00' * 240)


class FakeClient:
    base_url = 'https://example.invalid/tts'
    headers = {}

    def __init__(self):
        self.http = FakeHTTP()
        self.ready = 'OK'
        self.model = voice.DEFAULT_MODEL

    def query_voice(self, voice_id):
        return {'status': self.ready, 'target_model': self.model}

    def synthesize(self, **kw):
        self.synthesis = kw
        return {'url': 'https://example.invalid/signed-secret', 'characters': 2}


class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.registry = {'version': 1, 'voices': {}, 'service': {'workspace_id': 'ws-test'}}
        self.client = FakeClient()
        self.patcher = patch.object(voice, 'client_for', return_value=self.client)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def args(self, *items):
        return voice.parser().parse_args(['--registry', str(self.root / 'voices.json'), *items])

    def create_args(self):
        sample = self.root / 'sample.wav'
        sample.write_bytes(b'RIFF-example')
        return self.args('create', '--name', 'my-voice', '--prefix', 'myvoice', '--audio-file', str(sample))

    def test_create_uses_inline_sample_and_saves_id_before_query(self):
        args = self.create_args()
        def query(_):
            saved = voice.read_json(args.registry)
            self.assertEqual(saved['voices']['my-voice']['voice_id'], 'new-id')
            return {'status': 'OK', 'target_model': voice.DEFAULT_MODEL}
        self.client.query_voice = query
        result = voice.create(args, self.registry, {})
        self.assertEqual(result['status'], 'OK')
        payload = self.client.http.calls[0]
        self.assertEqual(payload['input']['action'], 'create_voice')
        self.assertTrue(payload['input']['audio'].startswith('data:audio/wav;base64,'))
        self.assertNotIn('audio', args.registry.read_text())

    def test_timeout_retains_placeholder_and_blocks_duplicate(self):
        args = self.create_args()
        self.client.http.json_request = lambda *a, **kw: (_ for _ in ()).throw(TimeoutError())
        with self.assertRaises(TimeoutError):
            voice.create(args, self.registry, {})
        saved = voice.read_json(args.registry)
        self.assertEqual(saved['voices']['my-voice']['status'], 'submission_unknown')
        with self.assertRaisesRegex(ValueError, '已存在'):
            voice.create(args, saved, {})

    def test_deploying_does_not_recreate(self):
        self.client.ready = 'DEPLOYING'
        args = self.create_args()
        args.wait = 0
        result = voice.create(args, self.registry, {})
        self.assertEqual(result['status'], 'DEPLOYING')
        self.assertEqual(len(self.client.http.calls), 1)

    def test_audio_validates_download_and_does_not_persist_signed_url(self):
        args = self.args('audio', '--voice', 'my-voice', '--text', '你好', '--output-root', str(self.root))
        v = {'model': voice.DEFAULT_MODEL, 'display_name': '声音'}
        result = voice.synthesize(args, 'my-voice', v, self.client, 'id')
        self.assertEqual(result['status'], 'completed')
        self.assertTrue(Path(result['outputs']['audio']).is_file())
        manifest = Path(result['directory']) / 'manifest.json'
        self.assertNotIn('signed-secret', manifest.read_text())
        self.assertEqual(self.client.synthesis['voice_id'], 'id')

    def test_invalid_text_and_model_do_not_synthesize(self):
        args = self.args('audio', '--voice', 'my-voice', '--text', 'x' * 15001)
        v = {'model': voice.DEFAULT_MODEL, 'display_name': '声音'}
        with self.assertRaises(ValueError):
            voice.synthesize(args, 'my-voice', v, self.client, 'id')
        self.client.model = 'wrong-model'
        args.text = '你好'
        with self.assertRaises(ValueError):
            voice.synthesize(args, 'my-voice', v, self.client, 'id')
        self.assertFalse(hasattr(self.client, 'synthesis'))

    def test_import_only_voice_config_and_preserve_existing(self):
        source = self.root / 'personas.toml'
        source.write_text("""
[services.bailian]
workspace_id = "ws-test"
region = "cn-beijing"
[services.heygen]
api_key_env = "HEYGEN_API_KEY"
[personas.da-tie-chui]
display_name = "大铁锤"
[personas.da-tie-chui.voices.main]
provider = "bailian"
model = "cosyvoice-v3.5-plus"
voice_id_env = "BAILIAN_VOICE_DA_TIE_CHUI"
[personas.da-tie-chui.avatars.main]
avatar_id = "unused"
""", encoding='utf-8')
        count = voice.import_avatar(source, self.registry)
        self.assertEqual(count, 1)
        self.assertNotIn('heygen', json.dumps(self.registry))
        self.assertEqual(voice.import_avatar(source, self.registry), 0)
        name, v = voice.resolve(self.registry, '大铁锤')
        self.assertEqual(name, 'da-tie-chui')
        self.assertEqual(v['voice_id_env'], 'BAILIAN_VOICE_DA_TIE_CHUI')

    def test_bind_recovers_without_create(self):
        self.registry['voices']['my-voice'] = {'display_name': '声音', 'model': voice.DEFAULT_MODEL,
                                                'service': self.registry['service'], 'status': 'submission_unknown'}
        path = self.root / 'recovery.json'
        voice.save_json(path, {'voice_id': 'recovered-id'})
        args = self.args('bind', '--name', 'my-voice', '--source-json', str(path))
        voice.save_json(args.registry, self.registry)
        with patch.object(voice, 'credentials', return_value={}):
            result = voice.run(args)
        self.assertEqual(result['status'], 'OK')
        self.assertEqual(voice.read_json(args.registry)['voices']['my-voice']['voice_id'], 'recovered-id')
        self.assertEqual(len(self.client.http.calls), 0)


if __name__ == '__main__':
    unittest.main()
