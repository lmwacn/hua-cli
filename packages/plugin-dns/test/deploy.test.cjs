const { test } = require('node:test');
const assert = require('node:assert/strict');
const { covers, findTasks, ensureTask } = require('../dist/deploy');

function task(overrides = {}) {
  return { id: 38, aid: 2, oid: 1, type: 'btpanel', aname: 'https://192.0.2.10:31840',
    config: JSON.stringify({ type: '0', sites: 'old.example.com', retained: 'keep', key: 'do-not-print' }),
    domains: ['*.example.com'], active: 1, status: 1, ...overrides };
}
function service(tasks, orderOverrides = {}) {
  const writes = [];
  const reads = [];
  const call = async (tool, args) => {
    reads.push({ tool, ...args });
    if (tool === 'cert_order_query') return { rows: [{ id: 1, status: 3, isauto: 1, expiretime: '2099-01-01 00:00:00', domains: ['*.example.com'], ...orderOverrides }] };
    if (tool === 'cert_account_query') return { rows: [{ id: 2, type: 'btpanel' }] };
    if (tool === 'cert_deploy_query') {
      const rows = tasks.filter(t => args.aid === undefined || t.aid === args.aid);
      // 模拟服务端每页最多一条，确保跟随实际分页而非假定 limit 生效。
      return { total: rows.length, rows: rows.slice(args.offset, args.offset + 1) };
    }
    if (tool === 'cert_deploy_manage') {
      writes.push(args);
      if (args.action === 'edit') tasks.find(t => t.id === args.id).config = JSON.stringify(args.config);
      else if (args.action === 'add') tasks.push(task({ id: 74, config: JSON.stringify(args.config) }));
      else throw new Error('Unexpected mutation');
      return { code: 0 };
    }
    throw new Error('Unexpected tool');
  };
  return { call, writes, reads };
}
const options = { aid: 2, oid: 1, site: 'pan.example.com', domain: 'pan.example.com' };

test('通配符只覆盖一级子域名，域名大小写和末尾点归一化', () => {
  assert.equal(covers('*.EXAMPLE.com.', 'Pan.example.com.'), true);
  assert.equal(covers('*.example.com', 'example.com'), false);
  assert.equal(covers('*.example.com', 'a.b.example.com'), false);
  assert.equal(covers('*.example.com', 'badexample.com'), false);
});

test('分页搜索按域名覆盖、账户IP、部署站点取交集，隐藏其他配置', async () => {
  const s = service([task({ id: 1, aid: 3, aname: 'https://192.0.2.11:8888' }), task()]);
  const result = await findTasks(s.call, { domain: 'new.example.com', ip: '192.0.2.10' });
  assert.deepEqual(result.rows.map(t => t.id), [38]);
  assert.deepEqual(result.rows[0].matched_by, ['certificate_domain', 'account_host']);
  assert.ok(!JSON.stringify(result).includes('do-not-print'));
  assert.ok(!JSON.stringify(result).includes('retained'));
  assert.equal((await findTasks(s.call, { site: 'old.example.com', aid: 2 })).total, 1);
  assert.equal((await findTasks(s.call, { site: 'old' })).total, 0);
  assert.equal((await findTasks(s.call, { domain: 'a.b.example.com' })).total, 0);
  assert.equal(s.writes.length, 0);
});

test('复用原任务追加站点并保留全部原配置，重复调用不写入', async () => {
  const tasks = [task()];
  const s = service(tasks);
  assert.equal((await ensureTask(s.call, options)).action, 'reused');
  assert.deepEqual(JSON.parse(tasks[0].config), { type: '0', sites: 'old.example.com\npan.example.com', retained: 'keep', key: 'do-not-print' });
  assert.equal((await ensureTask(s.call, options)).action, 'unchanged');
  assert.equal(s.writes.length, 1);
  assert.equal(tasks.length, 1);
});

test('没有可复用任务才创建；之后再次执行不会重复添加', async () => {
  const tasks = [];
  const s = service(tasks);
  assert.equal((await ensureTask(s.call, options)).action, 'created');
  assert.equal((await ensureTask(s.call, options)).action, 'unchanged');
  assert.equal(s.writes.length, 1);
  assert.equal(tasks.length, 1);
});

test('多候选、不同证书、重复站点和停用任务均阻止写入；可显式选择候选', async () => {
  for (const tasks of [
    [task(), task({ id: 39 })],
    [task({ oid: 2, config: { type: '0', sites: options.site } })],
    [task({ config: { type: '0', sites: options.site } }), task({ id: 39, config: { type: '0', sites: options.site } })],
    [task({ active: 0 })],
  ]) {
    const s = service(tasks);
    await assert.rejects(ensureTask(s.call, options));
    assert.equal(s.writes.length, 0);
  }
  const s = service([task(), task({ id: 39 })]);
  assert.equal((await ensureTask(s.call, { ...options, id: 39 })).id, 39);
  assert.equal(s.writes[0].id, 39);
});

test('证书未覆盖、未签发、过期或未开启自动续签时均不写入', async () => {
  for (const order of [{ domains: ['*.other.com'] }, { status: 1 }, { isauto: 0 }, { expiretime: '2000-01-01' }, { expiretime: 'invalid' }]) {
    const s = service([task()], order);
    await assert.rejects(ensureTask(s.call, options));
    assert.equal(s.writes.length, 0);
  }
});

test('不完整分页、不可读配置与写入超时直接报错，不退回创建', async () => {
  await assert.rejects(findTasks(async () => ({ total: 1, rows: [] }), { aid: 2 }), /分页不完整/);
  await assert.rejects(findTasks(service([task({ config: 'secret-invalid-json' })]).call, { aid: 2 }), e => !e.message.includes('secret-invalid-json'));
  const s = service([task()]);
  let writes = 0;
  await assert.rejects(ensureTask(async (tool, args) => {
    if (tool === 'cert_deploy_manage') { writes++; throw new Error('请求超时'); }
    return s.call(tool, args);
  }, options), /请求超时/);
  assert.equal(writes, 1);
});

test('命令经 HTTP 完成查询、复用、回查和重复调用，原站点不丢失', async () => {
  const http = require('node:http');
  const { once } = require('node:events');
  const { dnsPlugin } = require('../dist');
  const { profiles } = require('../dist/profile-store');
  const s = service([task()]);
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, 'Bearer 7:integration-token');
    const tool = req.url.split('/').pop();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(await s.call(tool, JSON.parse(body))));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const original = profiles.resolveProfile;
  const originalToken = process.env.HUA_DNS_DEPLOY_TEST_TOKEN;
  process.env.HUA_DNS_DEPLOY_TEST_TOKEN = 'integration-token';
  profiles.resolveProfile = () => ({ profile: { baseUrl: `http://127.0.0.1:${server.address().port}`, uid: 7, tokenEnv: 'HUA_DNS_DEPLOY_TEST_TOKEN' } });
  const run = async (name, options) => {
    const cmd = dnsPlugin.commands.find(c => c.name === name && c.parentPath?.[0] === 'deploy');
    let result;
    await cmd.action({ args: [], options, log: text => { result = JSON.parse(text); }, error: message => { throw new Error(message); } });
    return result;
  };
  try {
    assert.equal((await run('find', { domain: options.domain, ip: '192.0.2.10' })).rows[0].id, 38);
    assert.equal((await run('ensure', options)).action, 'reused');
    assert.equal((await run('ensure', options)).action, 'unchanged');
    const found = await run('find', { site: options.site });
    assert.deepEqual(found.rows[0].sites, ['old.example.com', options.site]);
    assert.equal(s.writes.length, 1);
    assert.equal(s.writes[0].action, 'edit');
    assert.ok(!JSON.stringify(found).includes('do-not-print'));
  } finally {
    profiles.resolveProfile = original;
    if (originalToken === undefined) delete process.env.HUA_DNS_DEPLOY_TEST_TOKEN;
    else process.env.HUA_DNS_DEPLOY_TEST_TOKEN = originalToken;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
