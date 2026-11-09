export function renderPanel(token: string, nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SSH 管理</title>
<style nonce="${nonce}">
  :root {
    color-scheme: light dark;
    font: 15px/1.5 system-ui, sans-serif;
    --canvas: light-dark(#f3f5f9, #10141c);
    --surface: light-dark(#fff, #181e29);
    --subtle: light-dark(#f6f8fc, #202837);
    --line: light-dark(#e0e6ef, #30394a);
    --ink: light-dark(#182338, #e9eef8);
    --muted: light-dark(#53627a, #aebad0);
    --accent: light-dark(#244bc2, #a5b7ff);
    --accent-bg: light-dark(#edf1ff, #273457);
    --success: light-dark(#136540, #8cd9ad);
    --danger: light-dark(#a02437, #ff9ba7);
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--canvas); color: var(--ink); }
  main { max-width: 100rem; margin: auto; padding: 1.5rem clamp(1rem, 3vw, 2.5rem); }
  header, .heading, .actions { display: flex; align-items: center; gap: .55rem; }
  header { justify-content: space-between; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1.25rem; }
  .heading { gap: .8rem; }
  .brand {
    display: grid; place-items: center; width: 2.9rem; height: 2.9rem; border-radius: .8rem;
    background: var(--accent-bg); color: var(--accent);
  }
  .actions { flex-wrap: wrap; }
  h1, h2, p { margin: 0; }
  h1 { font-size: clamp(1.5rem, 4vw, 2rem); letter-spacing: -.025em; }
  h2 { font-size: 1.25rem; }
  button, input, select { font: inherit; color: inherit; }
  button {
    cursor: pointer; border: 1px solid var(--line); border-radius: .55rem;
    padding: .48rem .8rem; background: var(--surface); font-weight: 600;
  }
  button:hover { background: var(--subtle); }
  button:disabled { cursor: default; opacity: .5; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .primary { background: #2d51cf; border-color: #2d51cf; color: #fff; }
  .primary:hover { background: #2341ad; }
  .secondary, .test { background: var(--accent-bg); color: var(--accent); border-color: transparent; }
  .panel-head {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
    gap: .5rem; margin-bottom: .65rem;
  }
  .panel-head h2 { font-size: 1rem; }
  .count, .tag { display: inline-block; border-radius: 1rem; background: var(--subtle); color: var(--muted); }
  .count, .tag { padding: .12rem .55rem; font-size: .8rem; font-weight: 600; white-space: nowrap; }
  .tag { margin-left: .5rem; background: var(--accent-bg); color: var(--accent); }
  #test-summary { color: var(--accent); font-size: .9rem; font-variant-numeric: tabular-nums; }
  #notice:not(:empty) { margin-bottom: 1rem; }
  #empty {
    padding: 2rem 1rem; text-align: center; color: var(--muted);
    border: 1px dashed var(--line); border-radius: .75rem;
  }
  .profiles {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: .6rem; list-style: none; padding: 0; margin: 0;
  }
  .profile {
    display: flex; flex-direction: column; gap: .25rem; min-width: 0;
    padding: .6rem .8rem; border: 1px solid var(--line); border-radius: .75rem;
    background: var(--surface); overflow-wrap: anywhere;
  }
  .profile-head, .profile-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: .3rem .5rem; }
  .profile-head { justify-content: space-between; }
  .profile h3 { margin: 0; font-size: 1rem; }
  .profile .tag { margin: 0; }
  .address { font: .85rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .auth, .status, .failure { color: var(--muted); font-size: .82rem; }
  .auth { margin-left: auto; }
  .failure summary { color: var(--danger); cursor: pointer; }
  .failure p { margin-top: .2rem; }
  .success { color: var(--success); }
  .error { color: var(--danger); }
  .row-actions { gap: .25rem; margin-top: auto; }
  .row-actions button { font-size: .84rem; padding: .34rem .5rem; border-color: transparent; }
  .row-actions button:not(.test) { background: transparent; }
  .row-actions button:hover { border-color: var(--line); }
  .row-actions button:last-child:hover { color: var(--danger); }
  small { font-size: .85rem; color: var(--muted); }
  dialog {
    width: min(31rem, calc(100% - 2rem)); max-height: calc(100% - 2rem);
    padding: clamp(1rem, 4vw, 1.65rem); border: 1px solid var(--line); border-radius: .9rem;
    background: var(--surface); color: var(--ink); box-shadow: 0 20px 60px #10141c40;
  }
  dialog::backdrop { background: #0b112263; }
  form { display: grid; gap: .9rem; margin-top: 1.15rem; }
  label { display: grid; gap: .3rem; font-size: .88rem; font-weight: 600; }
  label small { font-weight: 400; }
  input, select { width: 100%; min-width: 0; background: var(--canvas); padding: .52rem .65rem; border: 1px solid var(--line); border-radius: .45rem; }
  input[type=checkbox] { width: auto; margin: 0; }
  .check { display: flex; align-items: center; gap: .5rem; }
  .pair { display: grid; grid-template-columns: 2fr 1fr; gap: .75rem; }
  form .actions { justify-content: flex-end; }
  [role=alert]:empty { display: none; }
</style>
</head>
<body>
<main>
  <header>
    <div class="heading">
      <span class="brand" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="m6.5 9 3 3-3 3m6 0h4.5"/></svg></span>
      <h1>SSH 管理</h1>
    </div>
    <div class="actions">
      <button id="refresh">刷新</button>
      <button id="test-all" class="secondary" disabled>批量测试</button>
      <button id="add" class="primary">新增连接</button>
    </div>
  </header>
  <p id="notice" class="error" role="alert"></p>
  <section aria-labelledby="connections">
    <div class="panel-head">
      <div class="actions"><h2 id="connections">连接列表</h2><span id="connection-count" class="count" hidden></span></div>
      <p id="test-summary" role="status" hidden></p>
    </div>
    <p id="empty" hidden>暂无 SSH 配置。</p>
    <ul id="profiles" class="profiles" role="list" aria-labelledby="connections" hidden></ul>
  </section>
</main>
<dialog id="editor" aria-labelledby="editor-title">
  <h2 id="editor-title"></h2>
  <form id="profile-form">
    <label>名称<input name="name" required></label>
    <div class="pair">
      <label>主机名或 IP<input name="host" required></label>
      <label>端口<input name="port" type="number" min="1" max="65535" required></label>
    </div>
    <label>用户名<input name="username" required></label>
    <label>认证方式
      <select name="authMethod"><option value="password">密码</option><option value="key">私钥</option></select>
    </label>
    <label id="password-field">密码<input name="password" type="password" autocomplete="new-password"><small id="password-hint" hidden>留空保留原密码</small></label>
    <label id="key-field" hidden>私钥路径<input name="privateKeyPath" placeholder="/绝对路径/id_ed25519"></label>
    <label id="passphrase-field" hidden>私钥口令<input name="passphrase" type="password" autocomplete="new-password"><small id="passphrase-hint" hidden>留空保留原口令</small></label>
    <label id="clear-field" class="check" hidden><input name="clearPassphrase" type="checkbox">清除原口令</label>
    <p id="form-error" class="error" role="alert"></p>
    <div class="actions">
      <button id="save" class="primary" type="submit">保存</button>
      <button id="cancel" type="button">取消</button>
    </div>
  </form>
</dialog>
<script nonce="${nonce}">
  const token = "${token}";
  const byId = (id) => document.getElementById(id);
  const editor = byId("editor");
  const form = byId("profile-form");
  const notice = byId("notice");
  const fields = form.elements;
  const cards = byId("profiles");
  const testAll = byId("test-all");
  const summary = byId("test-summary");
  let entries = new Map();
  let batch = [];
  let editing;
  let busy = false;
  let batchRunning = false;

  async function api(path, input) {
    const headers = { "X-Hua-Panel": token };
    const options = { headers };
    if (input !== undefined) {
      options.method = "POST";
      options.body = JSON.stringify(input);
      headers["Content-Type"] = "application/json";
    }
    let response;
    try {
      response = await fetch("/api/" + path, options);
    } catch {
      throw new Error("无法访问本地面板，请检查 hua ssh panel 是否仍在运行。");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }

  function button(label, onClick) {
    const element = document.createElement("button");
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
  }

  function render(profiles) {
    const count = byId("connection-count");
    count.textContent = profiles.length + " 条";
    count.hidden = false;
    cards.hidden = profiles.length === 0;
    byId("empty").hidden = profiles.length > 0;
    const versions = new Map(profiles.map((profile) => [profile.name, profile.version]));
    for (const [name, entry] of entries) {
      if (entry.version !== versions.get(name)) {
        entry.card.remove();
        entries.delete(name);
      }
    }
    const orderedEntries = new Map();
    profiles.forEach((profile, index) => {
      const entry = entries.get(profile.name) ?? createCard(profile);
      orderedEntries.set(profile.name, entry);
      entry.setDefault(profile.isDefault);
      if (cards.children[index] !== entry.card) {
        cards.insertBefore(entry.card, cards.children[index] ?? null);
      }
    });
    entries = orderedEntries;
    testAll.disabled = batchRunning || entries.size === 0;
    if (!summary.hidden) reportBatch();
  }

  function createCard(profile) {
    const card = document.createElement("li");
    card.className = "profile";
    const heading = document.createElement("div");
    heading.className = "profile-head";
    const name = document.createElement("h3");
    name.textContent = profile.name;
    heading.append(name);
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "默认";
    heading.append(tag);
    const host = profile.host.includes(":") ? "[" + profile.host + "]" : profile.host;
    const address = document.createElement("p");
    address.className = "address";
    address.textContent = profile.username + "@" + host + ":" + profile.port;
    const meta = document.createElement("div");
    meta.className = "profile-meta";
    const auth = document.createElement("span");
    auth.className = "auth";
    auth.textContent = profile.authMethod === "key" ? "私钥" : "密码";
    const result = document.createElement("span");
    result.className = "status";
    result.textContent = "未测试";
    result.setAttribute("role", "status");
    const failure = document.createElement("details");
    failure.className = "failure";
    failure.hidden = true;
    const failureLabel = document.createElement("summary");
    failureLabel.textContent = "查看原因";
    const failureMessage = document.createElement("p");
    failure.append(failureLabel, failureMessage);
    meta.append(result, failure, auth);
    const actions = document.createElement("div");
    actions.className = "actions row-actions";
    const showStatus = (message, tone = "", reason = "") => {
      result.className = ("status " + tone).trim();
      result.textContent = message;
      failure.open = false;
      failure.hidden = !reason;
      failureMessage.textContent = reason;
    };
    let pending;
    const runTest = () => {
      if (pending) return pending;
      control.disabled = true;
      showStatus("正在连接…");
      pending = api("test", { name: profile.name, version: profile.version }).then((data) => {
        showStatus("认证成功 · " + data.elapsedMs + " ms", "success");
        return true;
      }, (error) => {
        showStatus("测试失败", "error", error.message);
        return false;
      }).finally(() => {
        pending = undefined;
        control.disabled = false;
      });
      return pending;
    };
    const control = button("测试", () => {
      if (!batchRunning) summary.hidden = true;
      runTest();
    });
    control.className = "test";
    const makeDefault = button("设为默认", () => update("default", { name: profile.name }));
    actions.append(control, button("编辑", () => openEditor(profile)), makeDefault);
    actions.append(button("删除", () => {
      if (!busy && confirm("删除 SSH 配置「" + profile.name + "」？")) {
        update("remove", { name: profile.name });
      }
    }));
    card.append(heading, address, meta, actions);
    return {
      card, runTest, version: profile.version, name: profile.name,
      isPending: () => Boolean(pending),
      queueTest() {
        if (pending) return;
        control.disabled = true;
        showStatus("等待测试…");
      },
      setDefault(isDefault) {
        tag.hidden = !isDefault;
        makeDefault.hidden = isDefault;
      },
    };
  }

  function reportBatch() {
    let skipped = 0;
    let succeeded = 0;
    let failed = 0;
    for (const item of batch) {
      if (entries.get(item.entry.name) !== item.entry) skipped++;
      else if (item.passed === true) succeeded++;
      else if (item.passed === false) failed++;
    }
    summary.textContent = "已测试 " + (succeeded + failed) + "/" + (batch.length - skipped) +
      " · 成功 " + succeeded + " · 失败 " + failed + (skipped ? " · 跳过 " + skipped : "");
  }

  async function runBatch() {
    if (batchRunning || entries.size === 0) return;
    batchRunning = testAll.disabled = true;
    // 优先接管已发起的单项测试，避免重复建立 SSH 连接。
    const snapshot = [...entries.values()];
    batch = [...snapshot.filter((entry) => entry.isPending()), ...snapshot.filter((entry) => !entry.isPending())]
      .map((entry) => ({ entry }));
    for (const { entry } of batch) entry.queueTest();
    summary.hidden = false;
    reportBatch();

    let next = 0;
    async function worker() {
      while (next < batch.length) {
        const item = batch[next++];
        if (entries.get(item.entry.name) !== item.entry) continue;
        item.passed = await item.entry.runTest();
        reportBatch();
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, batch.length) }, worker));
    } finally {
      batchRunning = false;
      testAll.disabled = entries.size === 0;
    }
  }

  async function update(action, input) {
    if (busy) return;
    busy = true;
    notice.textContent = "";
    try {
      render(await api(action, input));
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      busy = false;
    }
  }

  function syncAuth() {
    const isKey = fields.authMethod.value === "key";
    byId("password-field").hidden = isKey;
    byId("key-field").hidden = !isKey;
    byId("passphrase-field").hidden = !isKey;
    byId("clear-field").hidden = !isKey || !editing?.hasPassphrase;
    byId("password-hint").hidden = !editing?.hasPassword;
    byId("passphrase-hint").hidden = !editing?.hasPassphrase || fields.clearPassphrase.checked;
    fields.privateKeyPath.required = isKey;
    fields.passphrase.disabled = fields.clearPassphrase.checked;
  }

  function openEditor(profile) {
    if (busy) return;
    editing = profile;
    form.reset();
    byId("editor-title").textContent = profile ? "编辑连接" : "新增连接";
    byId("form-error").textContent = "";
    fields.name.value = profile?.name ?? "";
    fields.host.value = profile?.host ?? "";
    fields.port.value = profile?.port ?? 22;
    fields.username.value = profile?.username ?? "";
    fields.authMethod.value = profile?.authMethod ?? "password";
    fields.privateKeyPath.value = profile?.privateKeyPath ?? "";
    syncAuth();
    editor.showModal();
  }

  fields.authMethod.addEventListener("change", syncAuth);
  fields.clearPassphrase.addEventListener("change", syncAuth);
  byId("add").addEventListener("click", () => openEditor());
  byId("refresh").addEventListener("click", () => update("profiles"));
  testAll.addEventListener("click", runBatch);
  byId("cancel").addEventListener("click", () => editor.close());
  editor.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  editor.addEventListener("close", () => form.reset());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    byId("save").disabled = byId("cancel").disabled = true;
    byId("form-error").textContent = "";
    notice.textContent = "";
    try {
      render(await api("save", {
        ...Object.fromEntries(new FormData(form)),
        originalName: editing?.name,
        port: fields.port.valueAsNumber,
        clearPassphrase: fields.clearPassphrase.checked,
      }));
      editor.close();
    } catch (error) {
      byId("form-error").textContent = error.message;
    } finally {
      busy = false;
      byId("save").disabled = byId("cancel").disabled = false;
    }
  });

  update("profiles");
</script>
</body>
</html>`;
}
