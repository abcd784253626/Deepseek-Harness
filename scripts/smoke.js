// Electron 冒烟测试：验证 better-sqlite3 原生模块 + IPC 链路基础
const { app } = require('electron')
const path = require('node:path')

app.whenReady().then(() => {
  try {
    const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t(a TEXT)')
    db.prepare('INSERT INTO t VALUES (?)').run('hello-dsh-desktop')
    const row = db.prepare('SELECT a FROM t').get()
    console.log('SMOKE_OK better-sqlite3:', row.a, '| electron:', process.versions.electron)
    app.exit(0)
  } catch (err) {
    console.error('SMOKE_FAIL', err)
    app.exit(1)
  }
})
