/**
 * 插件市场状态：搜索、筛选、排序、已安装列表
 */
import { create } from 'zustand'
import type { InstalledPlugin, PluginCategory, RegistryPlugin } from '@shared/types'

export type SortKey = 'stars' | 'updated' | 'name'

interface PluginState {
  market: RegistryPlugin[]
  installed: InstalledPlugin[]
  query: string
  category: PluginCategory | 'all'
  sort: SortKey
  loading: boolean
  error: string | null
  search: () => Promise<void>
  setQuery: (q: string) => void
  setCategory: (c: PluginCategory | 'all') => void
  setSort: (s: SortKey) => void
  refreshInstalled: () => Promise<void>
}

export const usePlugins = create<PluginState>((set, get) => ({
  market: [],
  installed: [],
  query: '',
  category: 'all',
  sort: 'stars',
  loading: false,
  error: null,

  search: async () => {
    set({ loading: true, error: null })
    try {
      const market = await window.dsh.plugins.search(get().query)
      set({ market, loading: false })
    } catch (err) {
      set({ loading: false, error: (err as Error).message })
    }
  },

  setQuery: (query) => set({ query }),
  setCategory: (category) => set({ category }),
  setSort: (sort) => set({ sort }),

  refreshInstalled: async () => {
    const installed = await window.dsh.plugins.installed()
    set({ installed })
  }
}))

export function sortPlugins(list: RegistryPlugin[], sort: SortKey): RegistryPlugin[] {
  const copy = [...list]
  switch (sort) {
    case 'stars':
      return copy.sort((a, b) => b.stars - a.stars)
    case 'updated':
      return copy.sort((a, b) => b.updatedAt - a.updatedAt)
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name))
  }
}
