const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, PassThrough } = require('node:stream');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { splitStatements } = require('../dist/statements');
const { validateProfile, parseDriver } = require('../dist/profile-store');
const { formatResults } = require('../dist/format-results');
const { runSqlShell } = require('../dist/shell');
const { ConfigManager } = require('@hua/plugin-sdk');

const base = { host: 'localhost', user: 'tester', database: 'db' };
test('legacy profiles, aliases, ports and TLS validation', () => {
  assert.equal(validateProfile(base).driver, 'mysql');
  assert.equal(validateProfile(base).port, 3306);
  for (const driver of ['postgres', 'postgresql', 'pgsql']) {
    assert.equal(validateProfile({ ...base, driver }).driver, 'postgres');
    assert.equal(validateProfile({ ...base, driver }).port, 5432);
  }
  assert.throws(() => parseDriver('sqlite'), /Unsupported SQL driver/);
  assert.throws(() => validateProfile({ ...base, driver: 'oracle' }), /Unsupported SQL driver/);
  assert.throws(() => validateProfile({ ...base, ssl: 'false' }), /ssl must/);
  assert.equal(validateProfile({ ...base, port: 65536 }), null);
  assert.equal(validateProfile({ ...base, sslCa: '/tmp/ca.pem' }).ssl, true);
  assert.throws(() => validateProfile({ ...base, ssl: false, sslCa: '/tmp/ca.pem' }), /requires TLS/);
});

test('strict config fails without rewriting unsupported profiles; other plugins retain their default behavior', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hua-config-'));
  const configPath = path.join(dir, 'sql.json');
  const original = JSON.stringify({ profiles: { invalid: { ...base, driver: 'oracle' } } });
  writeFileSync(configPath, original);
  const schema = { name: 'sql', configPath, validateProfile, isProfileEqual: () => false };
  try {
    const strict = new ConfigManager({ ...schema, strictValidation: true });
    assert.throws(() => strict.resolveProfile('invalid'), /Unsupported SQL driver/);
    assert.throws(() => strict.addOrUpdateProfile('new', base), /Unsupported SQL driver/);
    assert.equal(readFileSync(configPath, 'utf8'), original);
    assert.deepEqual(new ConfigManager(schema).listProfiles(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, text, driver, count] of [
  ['quoted semicolon', "SELECT ';'; SELECT 'it''s; fine';", 'postgres', 2],
  ['dollar function', "DO $body$\nBEGIN\n PERFORM 1;\n RAISE NOTICE 'ok';\nEND\n$body$; SELECT 2;", 'postgres', 2],
  ['escape strings', String.raw`SELECT E'quote\';semicolon'; SELECT 2;`, 'postgres', 2],
  ['nested comments', '/* outside /* inside; */ still; */ SELECT 1; -- tail;\nSELECT 2;', 'postgres', 2],
  ['identifier with dollar', 'SELECT foo$bar FROM x; SELECT $$x;y$$;', 'postgres', 2],
  ['unicode dollar tag', 'SELECT $内容$x;y$内容$;', 'postgres', 1],
  ['mysql quotes', 'SELECT `semi;colon`, "x;y"; # comment;\nSELECT 2;', 'mysql', 2],
  ['mysql executable comment', '/*! SELECT 1 */;', 'mysql', 1],
  ['only comments', '-- hi;\n/* comment; */', 'postgres', 0],
]) {
  test(`SQL boundaries: ${name}`, () => {
    const parsed = splitStatements(text, driver);
    assert.equal(parsed.statements.length, count);
    assert.equal(parsed.remainder, '');
    assert.equal(parsed.incomplete, false);
  });
}
test('unfinished quotes/comments preserved across input chunks', () => {
  for (const text of ["SELECT 'abc;", 'DO $$BEGIN;', '/* unterminated']) {
    const parsed = splitStatements(text, 'postgres');
    assert.equal(parsed.statements.length, 0);
    assert.equal(parsed.incomplete, true);
    assert.equal(parsed.remainder, text);
  }
});
test('result formatter retains duplicate column names, null, JSON and large integers', () => {
  const result = formatResults([{ columns: ['n', 'n', 'v'], rows: [['9223372036854775807', null, { a: 1 }]] }]);
  assert.match(result, /9223372036854775807/);
  assert.match(result, /NULL/);
  assert.match(result, /\{"a":1\}/);
  assert.match(formatResults([{ columns: [], rows: [], affectedRows: 2 }]), /2 row\(s\) affected/);
});

function fixture(fail = false, input = Readable.from(['BEGIN;\nSELECT 1;\nCOMMIT;\nexit\n'])) {
  const calls = [], logs = [];
  let active = false, closed = 0;
  const connection = {
    async query(sql) {
      assert.equal(active, false, 'queries must not overlap');
      active = true; calls.push(sql);
      await new Promise(resolve => setTimeout(resolve, 20));
      active = false;
      if (fail && sql.startsWith('SELECT')) throw new Error('query rejected');
      return [{ columns: [], rows: [], command: 'OK' }];
    },
    async close() { assert.equal(active, false, 'EOF must await pending queries'); closed++; },
    onError() { return () => {}; },
  };
  return { calls, logs, closed: () => closed, run: () => runSqlShell(connection, {
    input, output: new PassThrough(), log: value => logs.push(value), error: value => logs.push(value),
    driver: 'postgres', timeoutMs: 10, interactive: false,
  }) };
}
test('shell drains piped input serially before exit, even when queries exceed idle timeout', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.calls, ['BEGIN;', 'SELECT 1;', 'COMMIT;']);
  assert.equal(f.closed(), 1);
});
test('batch errors stop subsequent SQL and close connection', async () => {
  const f = fixture(true); await assert.rejects(f.run(), /query rejected/);
  assert.deepEqual(f.calls, ['BEGIN;', 'SELECT 1;']);
  assert.equal(f.closed(), 1);
});
test('EOF executes trailing SQL without semicolon', async () => {
  const f = fixture(false, Readable.from(['SELECT 1'])); await f.run();
  assert.match(f.calls[0], /^SELECT 1/);
  assert.equal(f.closed(), 1);
});
test('unterminated SQL fails at EOF instead of reporting success', async () => {
  const f = fixture(false, Readable.from(["SELECT 'oops"]));
  await assert.rejects(f.run(), /Incomplete SQL/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.closed(), 1);
});
test('idle shell closes without terminating the host process', async () => {
  const f = fixture(false, new PassThrough()); await f.run();
  assert.equal(f.closed(), 1);
});
