// 子进程仍运行真实 CLI，仅把 SQL profile 存储定向到测试临时目录。
const store = require('../dist/profile-store');
if (!process.env.HUA_SQL_TEST_CONFIG) throw new Error('Missing isolated test config');
const manager = store.createProfileStore(process.env.HUA_SQL_TEST_CONFIG);
for (const method of ['getConfigPath', 'listProfiles', 'addOrUpdateProfile', 'removeProfile', 'setDefaultProfile', 'getProfile', 'getDefaultProfileName', 'resolveProfile', 'findDuplicateProfile']) {
  store[method] = (...args) => manager[method](...args);
}
