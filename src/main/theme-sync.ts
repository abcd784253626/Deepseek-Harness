/**
 * 官方 UI 主题偏好同步
 * 官方 dsh-client-ui-theme 在 settings.yaml 的 ui-theme.preference 字段
 * （light | dark | system，默认 system）—— 系统为暗色时官方 UI 即变灰。
 * 桌面主题切换时同步该字段，保证官方 UI 与桌面壳色调统一。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getSettings } from './store/database'

export function writeUiThemePreference(type: 'light' | 'dark'): void {
  try {
    const settings = getSettings()
    const path = join(settings.dshHomeOverride || join(homedir(), '.dsh'), 'settings.yaml')
    let doc: Record<string, unknown> = {}
    if (existsSync(path)) {
      const yaml = require('js-yaml') as typeof import('js-yaml')
      const parsed = yaml.load(readFileSync(path, 'utf-8'))
      if (parsed && typeof parsed === 'object') doc = parsed as Record<string, unknown>
    }
    doc['ui-theme'] = { preference: type }
    const yaml = require('js-yaml') as typeof import('js-yaml')
    writeFileSync(path, yaml.dump(doc, { noRefs: true }), 'utf-8')
  } catch {
    /* 同步失败不阻塞启动 */
  }
}
