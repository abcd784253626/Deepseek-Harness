/**
 * 运行模式 — 对应官方 dsh config/agent-presets 的四种预设
 * standard(标准) / code(代码) / minimal(极简) / cordis(创造)
 *
 * 切换模式 = 写 settings.yaml 的 agent-presets.default 键并重启内核，
 * 与官方配置体系完全互通。
 */
import type { AgentMode, AgentModeInfo } from '@shared/types'

export const AGENT_MODES: AgentModeInfo[] = [
  {
    id: 'standard',
    name: '标准模式',
    description: '功能完整的编程 Agent：文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理与工作流。',
    order: 1
  },
  {
    id: 'code',
    name: '代码模式',
    description: '聚焦编码任务的精简 Agent：核心工具链与文件编辑，减少上下文噪声。',
    order: 2
  },
  {
    id: 'minimal',
    name: '极简模式',
    description: '轻量对话式 Agent：最小工具面，适合快速问答与轻量任务。',
    order: 3
  },
  {
    id: 'cordis',
    name: '创造模式',
    description: 'Cordis 全能力 Agent：开放插件生态、技能与实验性工具全部挂载。',
    order: 4
  }
]

export function modeInfo(id: AgentMode): AgentModeInfo {
  return AGENT_MODES.find((m) => m.id === id) ?? AGENT_MODES[0]
}
