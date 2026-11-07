#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import sys
import time
import tomllib
import uuid
import wave

from voice_lib.bailian import BailianClient, NEXT_MODEL

STATE_ROOT = Path.home() / '.hua-voice'
DEFAULT_MODEL = 'cosyvoice-v3.5-plus'


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '-' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def credentials(env_file=None):
    values = {}
    for path in (Path.home() / '.hua-avatar/config.json', STATE_ROOT / 'config.json'):
        if path.exists():
            if os.name != 'nt' and path.stat().st_mode & 0o077:
                raise ValueError(f'凭据文件权限过宽：{path}；请设为 600')
            data = read_json(path)
            values.update(data.get('credentials', data))
    if env_file:
        for line in env_file.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if line and not line.startswith('#'):
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip().strip('\"').strip("'")
    values.update(os.environ)
    return values


def import_avatar(source, registry):
    with source.open('rb') as handle:
        data = tomllib.load(handle)
    cfg = data['services']['bailian']
    count = 0
    for pid, persona in data['personas'].items():
        for key, voice in persona['voices'].items():
            if voice.get('provider') != 'bailian':
                continue
            name = pid if key == 'main' else f'{pid}-{key}'
            if name in registry['voices']:
                continue
            registry['voices'][name] = {
                'display_name': persona['display_name'] + ('' if key == 'main' else f'/{key}'),
                'aliases': persona.get('aliases', []) if key == 'main' else [],
                'enabled': persona.get('enabled', True),
                'model': voice['model'],
                'service': cfg,
                **{k: voice[k] for k in ('voice_id', 'voice_id_env') if voice.get(k)},
            }
            count += 1
    registry.setdefault('service', cfg)
    return count


def resolve(registry, selector):
    if selector in registry['voices']:
        name = selector
    else:
        matches = [key for key, value in registry['voices'].items()
                   if selector == value['display_name'] or selector in value.get('aliases', [])]
        if len(matches) != 1:
            raise ValueError('音色名称不存在或不唯一，请运行 list 并使用 name')
        name = matches[0]
    voice = registry['voices'][name]
    if not voice.get('enabled', True):
        raise ValueError(f'音色已停用：{name}')
    return name, voice


def client_for(service, values):
    key = values.get(service.get('api_key_env', 'DASHSCOPE_API_KEY'))
    if not key:
        raise ValueError('缺少百炼 API Key，请配置环境变量或本地凭据文件')
    return BailianClient(workspace_id=service['workspace_id'],
                         region=service.get('region', 'cn-beijing'), api_key=key)


def voice_id_for(voice, values):
    result = voice.get('voice_id') or values.get(voice.get('voice_id_env'))
    if not result and voice.get('voice_id_env') == 'BAILIAN_VOICE_DA_TIE_CHUI':
        result = values.get('BAILIAN_VOICE_TECH_ROAST')
    if not result:
        raise ValueError('未配置该音色的 voice_id 或对应环境变量')
    return result


def enrollment(client, action, **fields):
    response = client.http.json_request('POST', client.base_url + '/customization',
                                      headers=client.headers,
                                      payload={'model': 'voice-enrollment',
                                               'input': {'action': action, **fields}})
    if not isinstance(response.get('output'), dict):
        raise ValueError('百炼未返回有效 output；不要自动重复提交')
    return response['output']


def status(client, voice_id, model, wait):
    deadline = time.monotonic() + wait
    while True:
        result = client.query_voice(voice_id)
        if result.get('target_model') and result['target_model'] != model:
            raise ValueError('远程音色绑定模型与本地配置不一致')
        state = result.get('status')
        if state == 'OK':
            return {'status': state, 'model': model}
        if state != 'DEPLOYING':
            raise ValueError(f'音色不可用：{state}')
        if time.monotonic() >= deadline:
            return {'status': state, 'model': model}
        time.sleep(min(2, max(0, deadline - time.monotonic())))


def audio_source(args):
    if args.audio_url:
        if not args.audio_url.startswith('https://'):
            raise ValueError('参考音频 URL 必须使用 HTTPS')
        return args.audio_url
    path = args.audio_file
    if path.suffix.lower() not in {'.wav', '.mp3', '.m4a'}:
        raise ValueError('本地样本支持 WAV、MP3、M4A')
    if not path.is_file() or not 0 < path.stat().st_size <= 10 * 1024 * 1024:
        raise ValueError('本地样本须非空且不超过本工具的 10 MiB 限制')
    mime = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4'}[path.suffix.lower()]
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def create(args, registry, values):
    if not re.fullmatch('[a-z0-9][a-z0-9-]{1,62}', args.name):
        raise ValueError('name 使用 2–63 位小写字母、数字、短横线')
    if args.name in registry['voices']:
        raise ValueError('音色名称已存在，不能覆盖或重复创建')
    if not re.fullmatch('[a-zA-Z0-9]{1,10}', args.prefix):
        raise ValueError('prefix 须为 1–10 位英文字母或数字')
    service = dict(registry.get('service') or {})
    if args.workspace_id:
        service.update(workspace_id=args.workspace_id, region='cn-beijing')
    if not service.get('workspace_id'):
        raise ValueError('请指定 --workspace-id 或先 import-avatar')
    sample = audio_source(args)
    client = client_for(service, values)
    # 提交前占位；超时后保留现场，阻止同名自动重试导致重复计费。
    voice = {'display_name': args.display_name or args.name, 'model': args.model,
             'service': service, 'status': 'submission_unknown'}
    registry['voices'][args.name] = voice
    registry.setdefault('service', service)
    save_json(args.registry, registry)
    output = enrollment(client, 'create_voice', target_model=args.model,
                        prefix=args.prefix, audio=sample)
    if not output.get('voice_id'):
        raise ValueError('创建接口未返回 voice_id；保留现场，不要自动重试')
    voice.update(voice_id=output['voice_id'], status='DEPLOYING')
    save_json(args.registry, registry)
    result = status(client, voice['voice_id'], voice['model'], args.wait)
    voice['status'] = result['status']
    save_json(args.registry, registry)
    return {'name': args.name, **result}


def synthesize(args, name, voice, client, voice_id):
    text = (args.text if args.text is not None else args.text_file.read_text(encoding='utf-8-sig')).strip()
    if not 0 < len(text) <= 15000:
        raise ValueError('文案须为 1–15000 字符，不自动拆分或截断')
    if status(client, voice_id, voice['model'], 0)['status'] != 'OK':
        raise ValueError('音色仍在部署，请稍后 status 查询')
    return save_audio(args, text, name, voice['display_name'], voice['model'], client, lambda: (
        client.synthesize(text=text, voice_id=voice_id, model=voice['model'], audio_format=args.format)
    ))


def synthesize_next(args, registry, values):
    text = (args.text_file.read_text(encoding='utf-8-sig') if args.text_file else args.text).strip()
    style = args.style.strip() if args.style else '一位女性用自然的普通话清晰地说'
    prompt = f'{style}。全程是单人干声。她逐字说：“{text}”'
    if not text or len(prompt) > 3000:
        raise ValueError('文案不能为空，文案和风格组成的提示词不得超过 3000 字符')
    service = dict(registry.get('service', {}))
    if args.workspace_id:
        service['workspace_id'] = args.workspace_id
    if not re.fullmatch(r'[a-zA-Z0-9-]+', service.get('workspace_id') or ''):
        raise ValueError('缺少有效百炼业务空间，请传 --workspace-id 或配置音色注册表')
    client = client_for(service, values)
    return save_audio(args, text, 'next', 'TTS Next', NEXT_MODEL, client, lambda: (
        client.synthesize_next(prompt=prompt, audio_format=args.format)
    ))


def save_audio(args, text, name, display_name, model, client, synthesize_audio):
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', args.title or display_name).strip(' .')[:100] or '配音'
    directory = args.output_root.resolve() / (title + '-' + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, exist_ok=False)
    (directory / 'script.txt').write_text(text + '\n', encoding='utf-8')
    manifest = {'status': 'synthesizing', 'name': name, 'model': model, 'outputs': {}}
    save_json(directory / 'manifest.json', manifest)
    try:
        audio = synthesize_audio()
        output = directory / ('audio.' + args.format)
        client.http.download(audio['url'], output)
        if args.format == 'wav':
            with wave.open(str(output), 'rb') as wav:
                if wav.getnframes() <= 0:
                    raise ValueError('生成 WAV 无有效音频帧')
        else:
            header = output.read_bytes()[:10]
            if not (header.startswith(b'ID3') or
                    (len(header) >= 2 and header[0] == 255 and header[1] & 224 == 224)):
                raise ValueError('生成 MP3 头部无效')
        manifest.update(status='completed', request_id=audio.get('request_id'),
                        characters=audio.get('characters'), outputs={'audio': str(output)})
    except Exception:
        manifest['status'] = 'failed_or_unknown'
        raise
    finally:
        save_json(directory / 'manifest.json', manifest)
    return {'directory': str(directory), **manifest}


def parser():
    p = argparse.ArgumentParser(description='百炼语音克隆与配音；不依赖 HeyGen')
    p.add_argument('--registry', type=Path, default=STATE_ROOT / 'voices.json')
    p.add_argument('--env-file', type=Path)
    sub = p.add_subparsers(dest='command', required=True)
    imp = sub.add_parser('import-avatar', help='仅本地导入旧技能的百炼音色配置')
    imp.add_argument('source', type=Path)
    sub.add_parser('list', help='列出本地音色，不输出资源 ID')
    sub.add_parser('doctor', help='本地配置与凭据检查，不请求远程接口')
    discover = sub.add_parser('discover', help='恢复创建结果不明时，分页查询远程音色')
    discover.add_argument('--prefix', required=True)
    discover.add_argument('--page', type=int, default=0)
    recover = sub.add_parser('bind', help='从本地 JSON 文件绑定已有或恢复的音色 ID')
    recover.add_argument('--name', required=True)
    recover.add_argument('--source-json', type=Path, required=True)
    c = sub.add_parser('create', help='从样本创建克隆音色，单次提交')
    c.add_argument('--name', required=True)
    c.add_argument('--display-name')
    c.add_argument('--prefix', required=True)
    c.add_argument('--model', default=DEFAULT_MODEL, choices=[DEFAULT_MODEL])
    c.add_argument('--workspace-id')
    source = c.add_mutually_exclusive_group(required=True)
    source.add_argument('--audio-file', type=Path)
    source.add_argument('--audio-url')
    c.add_argument('--wait', type=int, default=30, choices=range(0, 61), metavar='0..60')
    s = sub.add_parser('status', help='查询已有音色，不重复创建')
    s.add_argument('--voice', required=True)
    s.add_argument('--wait', type=int, default=0, choices=range(0, 61), metavar='0..60')
    a = sub.add_parser('audio', help='用已有克隆音色生成配音')
    a.add_argument('--voice', required=True)
    source = a.add_mutually_exclusive_group(required=True)
    source.add_argument('--text')
    source.add_argument('--text-file', type=Path)
    a.add_argument('--title')
    a.add_argument('--format', choices=['wav', 'mp3'], default='wav')
    a.add_argument('--output-root', type=Path, default=Path('Voice'))
    n = sub.add_parser('next', help='用 Qwen-Audio 3.1 TTS Next 生成单人配音')
    source = n.add_mutually_exclusive_group(required=True)
    source.add_argument('--text')
    source.add_argument('--text-file', type=Path)
    n.add_argument('--style')
    n.add_argument('--title')
    n.add_argument('--format', choices=['wav', 'mp3'], default='wav')
    n.add_argument('--output-root', type=Path, default=Path('Voice'))
    n.add_argument('--workspace-id')
    return p


def run(args):
    registry = read_json(args.registry) or {'version': 1, 'voices': {}}
    if args.command == 'import-avatar':
        count = import_avatar(args.source, registry)
        save_json(args.registry, registry)
        return {'imported': count, 'registry': str(args.registry)}
    if args.command == 'list':
        return [{'name': name, 'display_name': voice['display_name'],
                 'model': voice['model'], 'enabled': voice.get('enabled', True),
                 'status': voice.get('status', 'not_checked')}
                for name, voice in registry['voices'].items()]
    values = credentials(args.env_file)
    if args.command == 'doctor':
        return {'voices': len(registry['voices']),
                'service_configured': bool(registry.get('service', {}).get('workspace_id')),
                'api_key_configured': bool(values.get('DASHSCOPE_API_KEY')),
                'online_checked': False}
    if args.command == 'next':
        return synthesize_next(args, registry, values)
    if args.command == 'create':
        return create(args, registry, values)
    if args.command == 'discover':
        client = client_for(registry['service'], values)
        output = enrollment(client, 'list_voice', prefix=args.prefix, page_index=args.page, page_size=100)
        path = args.registry.parent / ('discovered-' + uuid.uuid4().hex[:8] + '.json')
        save_json(path, output)
        return {'saved_to': str(path), 'count': len(output.get('voice_list', [])), 'page': args.page}
    if args.command == 'bind':
        name, voice = resolve(registry, args.name)
        if voice.get('voice_id') or voice.get('voice_id_env'):
            raise ValueError('已有音色绑定，不允许覆盖')
        incoming = read_json(args.source_json)
        voice_id = incoming.get('voice_id')
        if not isinstance(voice_id, str) or not voice_id:
            raise ValueError('source-json 须含 voice_id 字符串')
        result = status(client_for(voice['service'], values), voice_id, voice['model'], 0)
        voice.update(voice_id=voice_id, status=result['status'])
        save_json(args.registry, registry)
        return {'name': name, **result}
    name, voice = resolve(registry, args.voice)
    client = client_for(voice['service'], values)
    voice_id = voice_id_for(voice, values)
    if args.command == 'status':
        result = status(client, voice_id, voice['model'], args.wait)
        voice['status'] = result['status']
        save_json(args.registry, registry)
        return {'name': name, **result}
    return synthesize(args, name, voice, client, voice_id)


def main():
    args = parser().parse_args()
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        # 不回显第三方错误正文、签名 URL 或凭据内容。
        print(json.dumps({'error': type(exc).__name__,
                          'message': str(exc) if isinstance(exc, (ValueError, FileNotFoundError))
                          else '操作失败；请检查本地状态，结果不明时不要自动重复提交。'},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
