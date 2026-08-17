/**
 * 工作区管理页：创建 / 切换 / 编辑 / 删除 / 打开目录
 * 每个工作区独立 cwd，可选独立 DSH_HOME（插件集与配置完全隔离）
 */
import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, Trash2, Pencil, Check, X } from 'lucide-react'
import { useApp } from '../stores/app'
import { Badge, Button, Modal } from '../components/ui'

export function WorkspacesPage(): React.JSX.Element {
  const { workspaces, activeWorkspaceId, refreshWorkspaces, setActiveWorkspace } = useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [dshHome, setDshHome] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  const create = async (): Promise<void> => {
    if (!name.trim() || !path.trim()) {
      setNotice('名称与路径不能为空')
      return
    }
    await window.dsh.workspace.create({ name: name.trim(), path: path.trim(), dshHome: dshHome.trim() || undefined })
    setCreateOpen(false)
    setName('')
    setPath('')
    setDshHome('')
    await refreshWorkspaces()
  }

  const remove = async (id: string): Promise<void> => {
    await window.dsh.workspace.remove(id)
    await refreshWorkspaces()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-medium" style={{ color: 'var(--fg)' }}>工作区</h1>
            <p className="text-[12px] fg-3">每个工作区独立 cwd 与可选独立 DSH_HOME；配置与原生 dsh 完全互通</p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <FolderPlus size={13} /> 新建工作区
          </Button>
        </div>

        {notice && <div className="text-[12px]" style={{ color: 'var(--danger)' }}>{notice}</div>}

        <div className="flex flex-col gap-2">
          {workspaces.map((ws) => (
            <div key={ws.id} className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ borderColor: ws.id === activeWorkspaceId ? 'var(--accent)' : 'var(--border)' }}>
              <FolderOpen size={15} className="fg-3" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {editing === ws.id ? (
                    <>
                      <input className="input-pill !w-44 !py-1" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                      <Button small onClick={async () => {
                        await window.dsh.workspace.update(ws.id, { name: editName })
                        setEditing(null)
                        await refreshWorkspaces()
                      }}>
                        <Check size={12} />
                      </Button>
                      <Button small onClick={() => setEditing(null)}><X size={12} /></Button>
                    </>
                  ) : (
                    <>
                      <span className="truncate text-[13px]" style={{ color: 'var(--fg)' }}>{ws.name}</span>
                      {ws.id === activeWorkspaceId && <Badge tone="accent">当前</Badge>}
                    </>
                  )}
                </div>
                <div className="truncate font-mono text-[11px] fg-3">{ws.path}</div>
                {ws.dshHome && <div className="truncate font-mono text-[11px] fg-3">DSH_HOME: {ws.dshHome}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {ws.id !== activeWorkspaceId && (
                  <Button small onClick={() => void setActiveWorkspace(ws.id)}>切换</Button>
                )}
                <Button small title="打开目录" onClick={() => void window.dsh.app.showItemInFolder(ws.path)}>
                  <FolderOpen size={12} />
                </Button>
                <Button small title="重命名" onClick={() => { setEditing(ws.id); setEditName(ws.name) }}>
                  <Pencil size={12} />
                </Button>
                <Button small variant="danger" title="删除（不删除磁盘文件）" onClick={() => void remove(ws.id)}>
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
          {workspaces.length === 0 && <div className="py-10 text-center text-[13px] fg-3">还没有工作区，点击右上角新建</div>}
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="新建工作区" width={560}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] fg-2">名称</label>
            <input className="input-pill" placeholder="如：我的项目" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] fg-2">路径（工作目录）</label>
            <div className="flex gap-2">
              <input className="input-pill flex-1 font-mono" placeholder="C:\projects\my-project" value={path} onChange={(e) => setPath(e.target.value)} />
              <Button onClick={async () => {
                const dir = await window.dsh.app.pickDirectory()
                if (dir) setPath(dir)
              }}>
                <FolderOpen size={13} /> 浏览
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] fg-2">独立 DSH_HOME（可选）</label>
            <div className="flex gap-2">
              <input className="input-pill flex-1 font-mono" placeholder="留空 = 使用全局 ~/.dsh（官方兼容）" value={dshHome} onChange={(e) => setDshHome(e.target.value)} />
              <Button onClick={async () => {
                const dir = await window.dsh.app.pickDirectory()
                if (dir) setDshHome(dir)
              }}>
                <FolderOpen size={13} /> 浏览
              </Button>
            </div>
            <span className="text-[11px] fg-3">指定后该工作区的插件集、配置与官方 ~/.dsh 完全隔离</span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void create()}>创建并切换</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
