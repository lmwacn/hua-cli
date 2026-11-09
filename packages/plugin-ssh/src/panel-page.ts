export function renderPanel(token: string, nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SSH 管理</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
  body { margin: 0; background: Canvas; color: CanvasText; }
  main { max-width: 70rem; margin: auto; padding: clamp(1rem, 4vw, 3rem); }
  header, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
  header { justify-content: space-between; margin-bottom: 1.5rem; }
  h1, h2 { margin: 0; }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; border: 1px solid GrayText; border-radius: .5rem; padding: .4rem .75rem; background: Canvas; }
  button:disabled { cursor: default; opacity: .55; }
  .primary { background: #1757c2; border-color: #1757c2; color: white; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: .8rem .65rem; border-bottom: 1px solid GrayText; }
  th { white-space: nowrap; }
  td { overflow-wrap: anywhere; }
  td:first-child { font-weight: 600; }
  small { font-size: .875rem; }
  .tag { margin-left: .5rem; font-weight: 400; white-space: nowrap; }
  dialog { width: min(30rem, calc(100% - 4rem)); padding: 1.25rem; border: 1px solid GrayText; border-radius: .75rem; }
  dialog::backdrop { background: rgb(0 0 0 / 45%); }
  form { display: grid; gap: .85rem; margin-top: 1rem; }
  label { display: grid; gap: .25rem; }
  label[hidden], div[hidden] { display: none; }
  input, select { min-width: 0; background: Canvas; padding: .4rem; border: 1px solid GrayText; border-radius: .35rem; }
  input[type=checkbox] { margin: 0; }
  .check { display: flex; align-items: center; gap: .5rem; }
  .pair { display: grid; grid-template-columns: 2fr 1fr; gap: .75rem; }
  .error { color: light-dark(#a42020, #ff9595); }
  [role=alert]:empty { margin: 0; }
</style>
</head>
<body>
<main>
  <header>
    <h1>SSH 管理</h1>
    <div class="actions">
      <button id="refresh">刷新</button>
      <button id="test-all" disabled>批量测试</button>
      <button id="add" class="primary">新增连接</button>
    </div>
  </header>
  <p id="notice" class="error" role="alert"></p>
  <p id="test-summary" role="status" hidden></p>
  <p id="empty" hidden>暂无 SSH 配置。</p>
  <div class="table-wrap">
    <table id="profiles" hidden>
      <thead><tr><th>名称</th><th>连接地址</th><th>认证</th><th>操作</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
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
    testAll.disabled = profiles.length === 0;
    summary.hidden = true;
    table.hidden = profiles.length === 0;
    byId("empty").hidden = profiles.length > 0;
    table.tBodies[0].replaceChildren();
    for (const profile of profiles) {
      const row = table.tBodies[0].insertRow();
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
      row.insertCell().textContent = profile.username + "@" + host + ":" + profile.port;
      row.insertCell().textContent = profile.authMethod === "key" ? "私钥" : "密码";
      const cell = row.insertCell();
      const actions = document.createElement("div");
      actions.className = "actions";
      const result = document.createElement("small");
      result.setAttribute("role", "status");
      let pending;
      const runTest = () => {
        if (pending) return pending;
        control.disabled = true;
        result.className = "";
        result.textContent = "正在连接…";
        pending = api("test", { name: profile.name }).then((data) => {
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
      cell.append(actions, result);
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
