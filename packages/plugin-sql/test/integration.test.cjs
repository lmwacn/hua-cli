const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, openSync, closeSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const mysql = require('mysql2/promise');
const { connectSql } = require('../dist/drivers');
const { createProfileStore } = require('../dist/profile-store');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function tool(name, envName) {
  return process.env[envName] || name;
}

test('real PostgreSQL and MySQL CLI integration (disposable local instances)', { timeout: 120000 }, async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hua-sql-'));
  const config = path.join(dir, 'sql.json');
  const pgData = path.join(dir, 'pg');
  const mysqlData = path.join(dir, 'mysql');
  const pgPort = await freePort(), mysqlPort = await freePort();
  let pgStarted = false, mysqlProcess;
  const initdb = tool('initdb', 'HUA_SQL_TEST_INITDB');
  const pgctl = tool('pg_ctl', 'HUA_SQL_TEST_PG_CTL');
  const mysqld = tool('mysqld', 'HUA_SQL_TEST_MYSQLD');
  const manager = createProfileStore(config);
  function cli(args, input) {
    return spawnSync(process.execPath, ['--require', path.join(__dirname, 'profile-fixture.cjs'), path.resolve(__dirname, '../../cli/dist/index.js'), 'sql', ...args], {
      env: { ...process.env, HUA_SQL_TEST_CONFIG: config }, input, encoding: 'utf8', timeout: 15000,
    });
  }
  function success(args, input) {
    const result = cli(args, input);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  try {
    execFileSync(initdb, ['-D', pgData, '--no-locale', '-E', 'UTF8', '-A', 'trust', '-U', 'hua_test'], { stdio: 'pipe' });
    execFileSync(pgctl, ['-D', pgData, '-l', path.join(dir, 'pg.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -k ''`, '-w', 'start'], { stdio: 'pipe' });
    pgStarted = true;
    mkdirSync(mysqlData);
    execFileSync(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${mysqlData}`], { stdio: 'pipe', timeout: 45000 });
    const mysqlLog = openSync(path.join(dir, 'mysql.log'), 'a');
    mysqlProcess = spawn(mysqld, ['--no-defaults', `--datadir=${mysqlData}`, `--port=${mysqlPort}`, '--bind-address=127.0.0.1', '--mysqlx=OFF', `--socket=${path.join(dir, 'm.sock')}`, `--pid-file=${path.join(dir, 'm.pid')}`], { stdio: ['ignore', mysqlLog, mysqlLog] });
    closeSync(mysqlLog);
    for (let attempt = 0; ; attempt++) {
      try {
        const conn = await mysql.createConnection({ host: '127.0.0.1', port: mysqlPort, user: 'root', connectTimeout: 500 });
        await conn.query('CREATE DATABASE hua_test'); await conn.end(); break;
      } catch (error) {
        if (attempt >= 100 || mysqlProcess.exitCode !== null) throw new Error(`Temporary MySQL failed: ${error.message}\n${readFileSync(path.join(dir, 'mysql.log'), 'utf8')}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    await t.test('profile add, aliases, defaults and driver-aware duplicate detection', () => {
      success(['profile', 'add', 'pg', '--driver', 'postgresql', '--host', '127.0.0.1', '--port', String(pgPort), '--user', 'hua_test', '--database', 'postgres']);
      success(['profile', 'add', 'my', '--host', '127.0.0.1', '--port', String(mysqlPort), '--user', 'root', '--database', 'hua_test']);
      success(['profile', 'add', 'default-pg', '--driver', 'pgsql', '--host', 'example.invalid', '--user', 'x', '--database', 'x']);
      success(['profile', 'add', 'default-my', '--host', 'example.invalid', '--user', 'x', '--database', 'x']);
      assert.equal(manager.getProfile('default-pg').port, 5432);
      assert.equal(manager.getProfile('default-my').port, 3306);
      success(['profile', 'add', 'same-address-other-driver', '--driver', 'postgres', '--host', '127.0.0.1', '--port', String(mysqlPort), '--user', 'root', '--database', 'hua_test']);
      assert.match(success(['profile', 'show', 'pg']), /driver=postgres/);
      assert.match(success(['profile', 'list']), /\[mysql\]/);
    });
    await t.test('legacy MySQL config without driver still queries', () => {
      const data = JSON.parse(readFileSync(config, 'utf8'));
      delete data.profiles.my.driver;
      writeFileSync(config, JSON.stringify(data));
      assert.match(success(['query', "SELECT 'legacy-ok' AS result", '-p', 'my']), /legacy-ok/);
    });
    for (const profile of ['pg', 'my']) {
      await t.test(`${profile}: query, empty rows and same-named columns`, () => {
        const output = success(['query', 'SELECT 1 AS value, 2 AS value', '-p', profile]);
        assert.match(output, /1\s+\|\s+2/);
        assert.match(success(['query', 'SELECT 1 WHERE 1=0', '-p', profile]), /empty result set/);
      });
      await t.test(`${profile}: piped transactions commit/rollback and EOF flush`, () => {
        const output = success(['shell', '-p', profile], `CREATE TABLE items (id INT PRIMARY KEY, label VARCHAR(80));\nBEGIN;\nINSERT INTO items VALUES (1, 'kept');\nCOMMIT;\nBEGIN;\nINSERT INTO items VALUES (2, 'rolled-back');\nROLLBACK;\nSELECT label FROM items ORDER BY id;\nexit\n`);
        assert.match(output, /kept/); assert.doesNotMatch(output, /rolled-back/);
        assert.match(success(['shell', '-p', profile], 'SELECT COUNT(*) AS total FROM items'), /1 row\(s\) returned/);
      });
      await t.test(`${profile}: batch error exits nonzero, stops later statements and rolls back`, () => {
        const result = cli(['shell', '-p', profile], "BEGIN;\nINSERT INTO items VALUES (3, 'not-committed');\nSELECT * FROM table_that_does_not_exist;\nCOMMIT;\nINSERT INTO items VALUES (4, 'must-not-run');\n");
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /table_that_does_not_exist/);
        assert.match(success(['query', 'SELECT id FROM items WHERE id IN (3,4)', '-p', profile]), /empty result set/);
      });
      await t.test(`${profile}: EOF/exit waits for slow query; idle timer does not cancel it`, () => {
        const sql = profile === 'pg' ? "SELECT pg_sleep(0.15), 'finished' AS v;" : "SELECT SLEEP(0.15), 'finished' AS v;";
        assert.match(success(['shell', '-p', profile, '--timeout', '0.05'], `${sql}\nexit\n`), /finished/);
      });
    }
    await t.test('PostgreSQL DO block, comments and dollar quoting in shell', () => {
      const output = success(['shell', '-p', 'pg'], `DO $body$\nBEGIN\n INSERT INTO items VALUES (5, 'function;value');\nEND;\n$body$;\n/* nested /* inner; */ outer; */\nSELECT label FROM items WHERE id=5; -- trailing comment\n`);
      assert.match(output, /function;value/);
    });
    await t.test('PostgreSQL RETURNING, JSON, bigint and multi-results', () => {
      assert.match(success(['query', "INSERT INTO items VALUES (6, 'returned') RETURNING label", '-p', 'pg']), /returned/);
      const output = success(['query', `SELECT 9223372036854775807::bigint AS n, '{"ok":true}'::jsonb AS j; SELECT 'second-result' AS v`, '-p', 'pg']);
      assert.match(output, /9223372036854775807/); assert.match(output, /\{"ok":true\}/); assert.match(output, /second-result/);
    });
    await t.test('unknown driver and invalid port fail without modifying config', () => {
      const before = readFileSync(config, 'utf8');
      const result = cli(['profile', 'add', 'bad', '--driver', 'oracle', '--host', 'localhost', '--user', 'x', '--database', 'x']);
      assert.equal(result.status, 1); assert.match(result.stderr, /Unsupported SQL driver/);
      assert.equal(cli(['profile', 'add', 'bad', '--port', '123abc', '--host', 'localhost', '--user', 'x', '--database', 'x']).status, 1);
      assert.equal(readFileSync(config, 'utf8'), before);
    });
    await t.test('stored unknown driver is rejected without MySQL fallback', () => {
      const before = readFileSync(config, 'utf8'); const data = JSON.parse(before);
      data.profiles.bad = { ...data.profiles.pg, driver: 'oracle' }; writeFileSync(config, JSON.stringify(data));
      const result = cli(['query', 'SELECT 1', '-p', 'bad']);
      assert.equal(result.status, 1); assert.match(result.stderr, /Unsupported SQL driver/);
      writeFileSync(config, before);
    });
    await t.test('PostgreSQL TLS fails closed when server does not offer TLS', async () => {
      await assert.rejects(connectSql({ ...manager.getProfile('pg'), ssl: true }), /SSL|TLS/);
    });
    await t.test('connection failures report target and nonzero exit', () => {
      manager.addOrUpdateProfile('missing-db', { ...manager.getProfile('pg'), database: 'does_not_exist' });
      const result = cli(['query', 'SELECT 1', '-p', 'missing-db']);
      assert.equal(result.status, 1); assert.match(result.stderr, /does_not_exist/);
    });
  } finally {
    if (mysqlProcess && mysqlProcess.exitCode === null) {
      const stopped = new Promise(resolve => mysqlProcess.once('exit', resolve));
      mysqlProcess.kill('SIGTERM');
      await stopped;
    }
    if (pgStarted) execFileSync(pgctl, ['-D', pgData, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
    rmSync(dir, { recursive: true, force: true });
  }
});
