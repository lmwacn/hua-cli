const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const cli = path.resolve(__dirname, '../../cli/dist/index.js');

test('CLI 分离合成与生成，验证参数、旧配置及下载失败恢复', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hua-tts-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const requests = [];
  let failDownload = false;
  const wav = Buffer.alloc(46);
  wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.end(failDownload ? '<html>error</html>' : wav); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body), auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ request_id: 'test-id', output: { audio: { url: `${base}/audio.wav` } } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const run = (...args) => exec(process.execPath, [cli, 'tts', ...args], {
    cwd: home, env: { ...process.env, HOME: home, DASHSCOPE_API_KEY: 'test-secret', SFM_WORKSPACE_ID: '' },
  });
  await run('config', 'set', '--base-url', `${base}/api/v1`, '--workspace-id', 'test');
  await t.test('稿件文件到 WAV，发送合成参数', async () => {
    await fs.writeFile(path.join(home, 'script.txt'), '\uFEFF你好');
    await run('synthesize', '--file', 'script.txt', '--instructions', '轻声说', '--rate', '0.8', '-o', 'speech.wav');
    assert.deepEqual(await fs.readFile(path.join(home, 'speech.wav')), wav);
    assert.equal(requests.at(-1).body.input.text, '你好');
    assert.equal(requests.at(-1).body.input.instruction, '轻声说');
    assert.equal(requests.at(-1).body.input.rate, 0.8);
    assert.equal(requests.at(-1).body.model, 'qwen-audio-3.1-tts-flash');
    assert.equal(requests.at(-1).auth, 'Bearer test-secret');
  });
  await t.test('场景提示词及本地参考音频到生成文件', async () => {
    await run('generate', '@voice1 说：“你好。”背景有雨声。', '--reference', 'speech.wav', '--channels', '2', '-o', 'scene.wav');
    const body = requests.at(-1).body;
    assert.equal(body.model, 'qwen-audio-3.1-tts-next');
    assert.equal(body.input.voice, undefined);
    assert.equal(body.input.text, undefined);
    assert.equal(body.input.sample_rate, 48000);
    assert.match(body.input.references[0].audio_data, /^data:audio\/wav;base64,/);
    assert.deepEqual(await fs.readFile(path.join(home, 'scene.wav')), wav);
  });
  await t.test('切换 provider 不继承另一模型音色，别名可执行', async () => {
    await run('config', 'set', '--provider', 'cosyvoice');
    await run('gen', '你好', '--print-url');
    assert.equal(requests.at(-1).body.model, 'cosyvoice-v3-flash');
    assert.equal(requests.at(-1).body.input.voice, 'longanyang');
    await run('next', '--text', '你好', '--style', '温柔女声', '--print-url');
    assert.match(requests.at(-1).body.input.text_prompt, /温柔女声/);
  });
  await t.test('错误输入在提交前拒绝，避免计费', async () => {
    const count = requests.length;
    for (const args of [
      ['generate', '你好', '--reference', 'speech.wav', '--reference', 'speech.wav', '--reference', 'speech.wav', '--reference', 'speech.wav'],
      ['generate', '@voice1 你好'], ['generate', '你好', '--format', 'opus'],
      ['synthesize', '你好', '--file', 'script.txt'], ['synthesize', '你好', '--rate', '1oops'],
      ['generate', '你好', '-o', 'bad.mp3'], ['generate', '你好', '--voice', 'Chelsie'],
    ]) await assert.rejects(run(...args));
    assert.equal(requests.length, count);
  });
  await t.test('失败下载不损坏旧文件，返回恢复 URL 且不重发合成', async () => {
    failDownload = true;
    const before = requests.length;
    await assert.rejects(run('synthesize', '你好', '-o', 'speech.wav'), error => {
      assert.match(error.stderr, /请勿重新生成/); assert.match(error.stderr, /audio.wav/); return true;
    });
    assert.equal(requests.length, before + 1);
    assert.deepEqual(await fs.readFile(path.join(home, 'speech.wav')), wav);
    assert.equal((await fs.readdir(home)).some(name => name.endsWith('.part')), false);
    failDownload = false;
  });
  await t.test('旧 Qwen 配置自动读取并使用旧接口', async () => {
    await fs.writeFile(path.join(home, '.hua/tts.json'), JSON.stringify({ provider: 'qwen', model: 'qwen3-tts-flash', voice: 'Chelsie', baseUrl: `${base}/api/v1` }));
    await run('gen', '你好', '--print-url');
    assert.equal(requests.at(-1).url, '/api/v1/services/aigc/multimodal-generation/generation');
    assert.deepEqual(requests.at(-1).body.input, { text: '你好', voice: 'Chelsie' });
  });
});

test('克隆音色全链路保持占位、恢复及模型绑定约束', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hua-clone-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const registry = path.join(home, '.hua-voice/voices.json');
  let createFailure = false, remoteModel = 'cosyvoice-v3.5-plus', creations = 0;
  const wav = Buffer.alloc(46); wav.write('RIFF'); wav.write('WAVE', 8);
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.end(wav); return; }
    let data = ''; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    let output;
    if (body.input.action === 'create_voice') {
      creations++;
      const saved = JSON.parse(await fs.readFile(registry, 'utf8'));
      assert.equal(saved.voices[createFailure ? 'failed-voice' : 'my-voice'].status, 'submission_unknown');
      assert.match(body.input.audio, /^data:audio\/wav;base64,/);
      if (createFailure) { res.statusCode = 500; res.end(JSON.stringify({ code: 'InternalError', request_id: 'unknown' })); return; }
      output = { voice_id: 'remote-id' };
    } else if (body.input.action === 'query_voice') {
      output = { status: 'OK', target_model: remoteModel };
    } else if (body.input.action === 'list_voice') {
      output = { voice_list: [{ voice_id: 'recovered-id', target_model: remoteModel }] };
    } else {
      assert.equal(body.model, remoteModel);
      assert.equal(body.input.voice, 'remote-id');
      output = { audio: { url: `${base}/audio.wav` } };
    }
    res.end(JSON.stringify({ request_id: 'test-clone', output }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const run = (...args) => exec(process.execPath, [cli, 'tts', ...args], {
    cwd: home, env: { ...process.env, HOME: home, DASHSCOPE_API_KEY: 'test-key', SFM_WORKSPACE_ID: '' },
  });
  await run('config', 'set', '--base-url', `${base}/api/v1`, '--workspace-id', 'test');
  await fs.writeFile(path.join(home, 'sample.wav'), wav);
  await run('clone', 'create', '--name', 'my-voice', '--prefix', 'myvoice', '--audio-file', 'sample.wav', '--wait', '0');
  let saved = JSON.parse(await fs.readFile(registry, 'utf8'));
  assert.equal(saved.voices['my-voice'].voice_id, 'remote-id');
  assert.equal(saved.voices['my-voice'].status, 'OK');
  assert.equal(JSON.stringify(saved).includes('test-key'), false);
  await run('clone', 'audio', '--voice', 'my-voice', '--text', '你好');
  const folders = await fs.readdir(path.join(home, 'Voice'));
  const manifest = JSON.parse(await fs.readFile(path.join(home, 'Voice', folders[0], 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'completed');
  assert.deepEqual(await fs.readFile(manifest.outputs.audio), wav);
  assert.equal(JSON.stringify(manifest).includes(base), false);
  remoteModel = 'wrong-model';
  await assert.rejects(run('clone', 'audio', '--voice', 'my-voice', '--text', '你好'), /模型与本地配置不一致/);
  remoteModel = 'cosyvoice-v3.5-plus'; createFailure = true;
  const create = ['clone', 'create', '--name', 'failed-voice', '--prefix', 'failure', '--audio-file', 'sample.wav', '--wait', '0'];
  await assert.rejects(run(...create));
  await assert.rejects(run(...create), /名称已存在/);
  assert.equal(creations, 2);
  saved = JSON.parse(await fs.readFile(registry, 'utf8'));
  assert.equal(saved.voices['failed-voice'].status, 'submission_unknown');
  await run('clone', 'discover', '--prefix', 'failure');
  await fs.writeFile(path.join(home, 'recovered.json'), JSON.stringify({ voice_id: 'recovered-id' }));
  await run('clone', 'bind', '--name', 'failed-voice', '--source-json', 'recovered.json');
  assert.equal(JSON.parse(await fs.readFile(registry, 'utf8')).voices['failed-voice'].voice_id, 'recovered-id');
  assert.equal(creations, 2);
  await fs.writeFile(path.join(home, 'old.toml'), '[services.bailian]\nworkspace_id="test"\n[personas.old]\ndisplay_name="旧声音"\n[personas.old.voices.main]\nprovider="bailian"\nmodel="cosyvoice-v3.5-plus"\nvoice_id="old-id"\n');
  await run('clone', 'import-avatar', 'old.toml');
  const again = await run('clone', 'import-avatar', 'old.toml');
  assert.equal(JSON.parse(again.stdout).imported, 0);
  assert.equal(JSON.parse(await fs.readFile(registry, 'utf8')).voices.old.voice_id, 'old-id');
});
