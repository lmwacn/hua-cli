const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { validateProfile } = require('../dist/profile-store');
const { request, redact } = require('../dist/client');
const { parseData } = require('../dist');

test('远程凭证仅通过 HTTPS，拒绝 URL 内嵌凭证和无效配置', () => {
  for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?token=secret', 'https://example.com/#token']) {
    assert.throws(() => validateProfile({ baseUrl, uid: 1 }));
  }
  assert.equal(validateProfile({ baseUrl: 'http://127.0.0.1:1234/', uid: 1 }).baseUrl, 'http://127.0.0.1:1234');
  assert.throws(() => validateProfile({ baseUrl: 'https://example.com', uid: 0 }));
  assert.throws(() => validateProfile({ baseUrl: 'https://example.com', uid: 1, tokenEnv: 'BAD-NAME' }));
  assert.throws(() => validateProfile({ baseUrl: 'https://example.com', uid: 1, tokenFile: 'relative' }));
});

test('默认递归隐藏私钥及账户配置，JSON 参数拒绝数组和标量', () => {
  assert.deepEqual(redact({ rows: [{ privatekey: 'secret', config: '{"password":"secret"}', domain: 'a.test' }] }), { rows: [{ privatekey: '***', config: '***', domain: 'a.test' }] });
  assert.throws(() => parseData('[]'));
  assert.throws(() => parseData('null'));
  assert.deepEqual(parseData('{"domains":["a.test"],"active":false}'), { domains: ['a.test'], active: false });
});

test('HTTP 错误、重定向、超时不自动重试，不泄露认证 token', async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    if (req.url.endsWith('/redirect')) { res.writeHead(302, { Location: '/stolen' }); res.end(); }
    else if (req.url.endsWith('/timeout')) { req.on('close', () => res.end()); }
    else if (req.url.endsWith('/bad_json')) { res.end('<html>failure</html>'); }
    else if (req.url.endsWith('/error')) { res.writeHead(422); res.end(JSON.stringify({ code: -1, msg: 'test-dns-token' })); }
    else { res.end(JSON.stringify({ code: 0, header: req.headers.authorization })); }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env.HUA_DNS_TEST_TOKEN = 'test-dns-token';
  const p = { baseUrl: `http://127.0.0.1:${server.address().port}`, uid: 7, tokenEnv: 'HUA_DNS_TEST_TOKEN' };
  try {
    assert.equal((await request(p)).header, 'Bearer 7:test-dns-token');
    await assert.rejects(request(p, 'error'), e => !e.message.includes('test-dns-token') && e.message.includes('422'));
    await assert.rejects(request(p, 'bad_json'), /未返回 JSON/);
    await assert.rejects(request(p, 'redirect'));
    await assert.rejects(request(p, 'timeout', {}, 20), /操作可能仍在服务器执行/);
    assert.equal(calls.filter(p => p.endsWith('/timeout')).length, 1);
    assert.ok(!calls.includes('/stolen'));
  } finally {
    delete process.env.HUA_DNS_TEST_TOKEN;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
