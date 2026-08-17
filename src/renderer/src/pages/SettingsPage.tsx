/**
 * 设置页：常规、内核路径、凭据（本地加密）、配置互通、关于
 */
import { useEffect, useState } from 'react'
import { KeyRound, Download, Upload, FolderOpen, Info, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../stores/app'
import { Badge, Button, Switch } from '../components/ui'
import type { CredentialEntry } from '@shared/types'

export function SettingsPage(): React.JSX.Element {
  const { settings, appInfo, saveSettings, refreshKernel } = useApp()
  const [credentials, setCredentials] = useState<CredentialEntry[]>([])
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [kernelPortText, setKernelPortText] = useState('0')

  useEffect(() => {
    void window.dsh.credentials.list().then(setCredentials)
    if (settings) setKernelPortText(String(settings.kernelPort))
  }, [settings])

  const addCredential = async (): Promise<void> => {
    if (!key.trim() || !secret) return
    await window.dsh.credentials.set(key.trim(), label.trim() || key.trim(), secret)
    setKey('')
    setLabel('')
    setSecret('')
    setNotice('凭据已加密保存（Windows DPAPI）')
    void window.dsh.credentials.list().then(setCredentials)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-6 py-6">
        {/* 常规 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-medium" style={{ color: 'var(--fg)' }}>常规</h2>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--fg)' }}>启动时自动拉起内核</div>
              <div className="text-[11px] fg-3">打开应用即启动 dsh --profile web，无需手动执行 CLI</div>
            </div>
            <Switch checked={settings?.autoStartKernel ?? true} onChange={(v) => void saveSettings({ autoStartKernel: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--fg)' }}>关闭窗口最小化到托盘</div>
              <div className="text-[11px] fg-3">后台保持内核进程存活，不中断任务</div>
            </div>
            <Switch checked={settings?.minimizeToTray ?? true} onChange={(v) => void saveSettings({ minimizeToTray: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--fg)' }}>内核端口</div>
              <div className="text-[11px] fg-3">0 = 自动分配空闲端口（推荐）</div>
            </div>
            <input
              className="input-pill !w-24 text-center font-mono"
              value={kernelPortText}
              onChange={(e) => setKernelPortText(e.target.value.replace(/\D/g, ''))}
              onBlur={() => {
                const port = Number(kernelPortText || 0)
                void saveSettings({ kernelPort: Math.min(port, 65535) })
              }}
            />
          </div>
        </section>

        {/* 内核与运行环境 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-medium" style={{ color: 'var(--fg)' }}>内核与运行环境</h2>
          <div className="flex flex-col gap-2 rounded-xl border px-4 py-3 text-[12px]" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <span className="fg-2">dsh CLI</span>
              <span className="font-mono">{appInfo?.dshPath ? `✓ ${appInfo.dshPath} (v${appInfo.dshVersion ?? '?'})` : '未找到'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="fg-2">pnpm（插件安装依赖）</span>
              <span>{appInfo?.pnpmAvailable ? '✓ 可用' : '✗ 未安装 — npm install -g pnpm'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="fg-2">DSH_HOME</span>
              <button type="button" className="cursor-pointer font-mono text-accent" onClick={() => void window.dsh.app.showItemInFolder(appInfo?.dshHome ?? '')}>
                {appInfo?.dshHome ?? ''}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="fg-2">Electron</span>
              <span className="font-mono">v{appInfo?.electron} · {appInfo?.platform} {appInfo?.arch}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button small onClick={async () => {
              const dir = await window.dsh.app.pickDirectory()
              if (dir) await saveSettings({ dshPathOverride: dir })
            }}>
              <FolderOpen size={12} /> 指定 dsh 路径
            </Button>
            <Button small onClick={async () => {
              const dir = await window.dsh.app.pickDirectory()
              if (dir) await saveSettings({ dshHomeOverride: dir })
            }}>
              <FolderOpen size={12} /> 指定 DSH_HOME
            </Button>
            <Button small onClick={() => void refreshKernel()}>刷新状态</Button>
          </div>
        </section>

        {/* 凭据 */}
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            <KeyRound size={14} /> API 凭据
            <span className="text-[11px] font-normal fg-3">本地加密存储（Windows DPAPI），绝不上传</span>
          </h2>
          <div className="flex flex-col gap-2">
            {credentials.map((c) => (
              <div key={c.key} className="flex items-center gap-2 rounded-xl border px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
                <span className="flex-1 text-[13px]" style={{ color: 'var(--fg)' }}>{c.label}</span>
                <code className="text-[11px] fg-3">{c.key}</code>
                <Badge tone="success">已保存</Badge>
                <Button small variant="danger" onClick={async () => {
                  await window.dsh.credentials.remove(c.key)
                  void window.dsh.credentials.list().then(setCredentials)
                }}>
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
            {credentials.length === 0 && <div className="text-[12px] fg-3">尚未保存任何凭据</div>}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex gap-2">
              <input className="input-pill !w-40" placeholder="环境变量键（如 DEEPSEEK_API_KEY）" value={key} onChange={(e) => setKey(e.target.value)} />
              <input className="input-pill flex-1" placeholder="显示名称" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <input className="input-pill flex-1" type="password" placeholder="密钥值（加密后存储）" value={secret} onChange={(e) => setSecret(e.target.value)} />
              <Button small variant="primary" disabled={!key.trim() || !secret} onClick={() => void addCredential()}>
                <Plus size={12} /> 保存
              </Button>
            </div>
          </div>
          <p className="text-[11px] fg-3">保存的凭据会写入 DSH_HOME/.credentials.yaml（官方格式），内核启动时自动注入对应环境变量。</p>
        </section>

        {/* 配置互通 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-medium" style={{ color: 'var(--fg)' }}>配置互通（官方 DSH 兼容）</h2>
          <div className="flex items-center gap-2">
            <Button small onClick={async () => {
              const file = await window.dsh.config.export()
              setNotice(file ? `已导出: ${file}` : '导出取消')
            }}>
              <Download size={12} /> 导出 settings.yaml
            </Button>
            <Button small onClick={async () => {
              const result = await window.dsh.config.import()
              if (result) {
                setNotice(`已导入 ${result.file}，原配置备份至 ${result.backup}。建议重启内核生效。`)
                void window.dsh.kernel.restart(useApp.getState().activeWorkspaceId)
              }
            }}>
              <Upload size={12} /> 导入 settings.yaml
            </Button>
          </div>
          <p className="text-[11px] fg-3">配置文件与原生 dsh 完全互通：工作区、插件集、模型配置、运行模式全部共享官方格式。</p>
        </section>

        {/* 关于 */}
        <section className="flex flex-col gap-2 pb-8">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            <Info size={14} /> 关于
          </h2>
          <div className="text-[12px] fg-2">
            DSH Desktop v{appInfo?.version} — 基于官方 DeepSeek Harness（MIT）封装的 Windows 桌面客户端。
            <br />
            内核：{appInfo?.dshVersion ? `dsh v${appInfo.dshVersion}` : '未安装 @deepseek-ai/dsh'}
          </div>
          <Button small onClick={() => void window.dsh.app.openExternal('https://github.com/deepseek-ai/deepseek-harness')}>
            官方仓库
          </Button>
        </section>

        {notice && <div className="pb-4 text-[12px]" style={{ color: 'var(--success)' }}>{notice}</div>}
      </div>
    </div>
  )
}
