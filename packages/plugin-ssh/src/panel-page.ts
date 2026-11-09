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
  main { max-width: 82rem; margin: auto; padding: clamp(1rem, 4vw, 3.5rem); }
  header, .heading, .actions { display: flex; align-items: center; gap: .55rem; }
  header { justify-content: space-between; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1.75rem; }
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
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: .9rem; overflow: hidden; }
  .panel-head {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
    gap: .5rem; padding: .85rem 1.1rem;
  }
  .panel-head h2 { font-size: 1rem; }
  .count, .tag { display: inline-block; border-radius: 1rem; background: var(--subtle); color: var(--muted); }
  .count, .tag { padding: .12rem .55rem; font-size: .8rem; font-weight: 600; white-space: nowrap; }
  .tag { margin-left: .5rem; background: var(--accent-bg); color: var(--accent); }
  #test-summary { color: var(--accent); font-size: .9rem; font-variant-numeric: tabular-nums; }
  #notice:not(:empty) { margin-bottom: 1rem; }
  #empty { padding: 2.5rem 1rem; text-align: center; color: var(--muted); border-top: 1px solid var(--line); }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: .72rem 1.1rem; border-top: 1px solid var(--line); }
  th { background: var(--subtle); color: var(--muted); font-size: .82rem; white-space: nowrap; }
  td { overflow-wrap: anywhere; }
  td:first-child { font-weight: 650; }
  tbody tr:hover { background: var(--subtle); }
  .address { font: .88rem/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .auth, .status { color: var(--muted); font-size: .85rem; }
  .status { max-width: 15rem; }
  .success { color: var(--success); }
  .error { color: var(--danger); }
  .row-actions { gap: .25rem; }
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
  @media (max-width: 52rem) {
    table, tbody { display: block; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .4rem .8rem; padding: .9rem 1.1rem; border-top: 1px solid var(--line); }
    td { display: block; padding: 0; border: 0; }
    .auth { grid-row: 1; grid-column: 2; }
    .address, .status, tbody td:last-child { grid-column: 1 / -1; }
    .status { max-width: none; }
    .row-actions button { padding: .44rem .6rem; }
  }
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
  <section class="panel" aria-labelledby="connections">
    <div class="panel-head">
      <div class="actions"><h2 id="connections">连接列表</h2><span id="connection-count" class="count" hidden></span></div>
      <p id="test-summary" role="status" hidden></p>
    </div>
    <p id="empty" hidden>暂无 SSH 配置。</p>
    <table id="profiles" role="table" aria-labelledby="connections" hidden>
      <thead role="rowgroup"><tr role="row"><th scope="col">名称</th><th scope="col">连接地址</th><th scope="col">认证</th><th scope="col">测试状态</th><th scope="col">操作</th></tr></thead>
      <tbody role="rowgroup"></tbody>
    </table>
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
  const table = byId("profiles");
  const testAll = byId("test-all");
  const summary = byId("test-summary");
  const rowTests = [];
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
    rowTests.length = 0;
    const count = byId("connection-count");
    count.textContent = profiles.length + " 条";
    count.hidden = false;
    testAll.disabled = profiles.length === 0;
    summary.hidden = true;
    table.hidden = profiles.length === 0;
    byId("empty").hidden = profiles.length > 0;
    table.tBodies[0].replaceChildren();
    for (const profile of profiles) {
      const row = table.tBodies[0].insertRow();
      row.setAttribute("role", "row");
      const nameCell = row.insertCell();
      const name = document.createElement("span");
      name.textContent = profile.name;
      nameCell.append(name);
      if (profile.isDefault) {
        const tag = document.createElement("small");
        tag.className = "tag";
        tag.textContent = "默认";
        nameCell.append(tag);
      }
      const host = profile.host.includes(":") ? "[" + profile.host + "]" : profile.host;
      const address = row.insertCell();
      address.className = "address";
      address.textContent = profile.username + "@" + host + ":" + profile.port;
      const auth = row.insertCell();
      auth.className = "auth";
      auth.textContent = profile.authMethod === "key" ? "私钥" : "密码";
      const status = row.insertCell();
      status.className = "status";
      const result = document.createElement("span");
      result.textContent = "未测试";
      result.setAttribute("role", "status");
      status.append(result);
      const cell = row.insertCell();
      for (const item of row.cells) item.setAttribute("role", "cell");
      const actions = document.createElement("div");
      actions.className = "actions row-actions";
      let pending;
      const runTest = () => {
        if (pending) return pending;
        control.disabled = true;
        result.className = "";
        result.textContent = "正在连接…";
        pending = api("test", { name: profile.name }).then((data) => {
          result.className = "success";
          result.textContent = "认证成功 · " + data.elapsedMs + " ms";
          return true;
        }, (error) => {
          result.className = "error";
          result.textContent = error.message;
          return false;
        }).finally(() => {
          pending = undefined;
          control.disabled = batchRunning;
        });
        return pending;
      };
      const control = button("测试", () => {
        if (!busy) {
          summary.hidden = true;
          runTest();
        }
      });
      control.className = "test";
      rowTests.push({ runTest, result, isPending: () => Boolean(pending) });
      actions.append(control, button("编辑", () => openEditor(profile)));
      if (!profile.isDefault) {
        actions.append(button("设为默认", () => update("default", { name: profile.name })));
      }
      actions.append(button("删除", () => {
        if (!busy && confirm("删除 SSH 配置「" + profile.name + "」？")) {
          update("remove", { name: profile.name });
        }
      }));
      cell.append(actions);
    }
  }

  async function runBatch() {
    if (busy || rowTests.length === 0) return;
    busy = batchRunning = true;
    const controls = document.querySelectorAll("main button");
    for (const control of controls) control.disabled = true;
    let completed = 0;
    let succeeded = 0;
    const total = rowTests.length;
    const report = () => {
      summary.textContent = "已测试 " + completed + "/" + total +
        " · 成功 " + succeeded + " · 失败 " + (completed - succeeded);
    };
    for (const test of rowTests) {
      if (!test.isPending()) {
        test.result.className = "";
        test.result.textContent = "等待测试…";
      }
    }
    summary.hidden = false;
    report();
    // 优先接管已发起的单项测试，避免重复建立 SSH 连接。
    const queue = [...rowTests.filter((test) => test.isPending()), ...rowTests.filter((test) => !test.isPending())];
    let next = 0;
    async function worker() {
      while (next < total) {
        const test = queue[next++];
        if (await test.runTest()) succeeded++;
        completed++;
        report();
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
    } finally {
      busy = batchRunning = false;
      for (const control of controls) control.disabled = false;
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
