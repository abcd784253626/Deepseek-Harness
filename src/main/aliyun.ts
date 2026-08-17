/**
 * 阿里百炼（DashScope）接入
 * - API Key 存本地加密库（DPAPI），启动内核时以环境变量注入官方运行时
 * - 模型配置写入官方 settings.yaml（llm-aliyun 段，openai-completions 兼容协议），
 *   与原生 DSH 配置完全互通
 * - 测试连接：直接调用 OpenAI 兼容端点完成一次真实对话
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readCredential, setCredential } from './security'
import { getSettings } from './store/database'

export const ALIYUN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const ALIYUN_KEY_ID = 'DASHSCOPE_API_KEY'

export const ALIYUN_MODELS = [
  { id: 'qwen-max', name: 'qwen-max（最强推理）' },
  { id: 'qwen-plus', name: 'qwen-plus（均衡）' },
  { id: 'qwen-turbo', name: 'qwen-turbo（快速）' },
  { id: 'qwen-long', name: 'qwen-long（长文本）' },
  { id: 'qwen3-coder-plus', name: 'qwen3-coder-plus（代码）' }
]

export interface AliyunConfig {
  enabled: boolean
  apiKeyId: string
  model: string
  modelLabel: string
}

function settingsYamlPath(): string {
  const settings = getSettings()
  return join(settings.dshHomeOverride || join(homedir(), '.dsh'), 'settings.yaml')
}

function readYaml(): Record<string, unknown> {
  const path = settingsYamlPath()
  if (!existsSync(path)) return {}
  try {
    const yaml = require('js-yaml') as typeof import('js-yaml')
    const parsed = yaml.load(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeYaml(doc: Record<string, unknown>): void {
  const path = settingsYamlPath()
  mkdirSync(join(path, '..'), { recursive: true })
  const yaml = require('js-yaml') as typeof import('js-yaml')
  writeFileSync(path, yaml.dump(doc, { noRefs: true }), 'utf-8')
}

export function getAliyunConfig(): AliyunConfig {
  const doc = readYaml()
  const section = (doc['llm-aliyun'] as Record<string, unknown>) ?? {}
  const provider = (section['providers'] as Record<string, unknown>)?.['aliyun'] as
    | Record<string, unknown>
    | undefined
  if (!provider) return { enabled: false, apiKeyId: ALIYUN_KEY_ID, model: 'qwen-max', modelLabel: 'qwen-max（最强推理）' }
  const models = (provider['models'] as Array<{ id?: string; name?: string }>) ?? []
  const model = models[0]?.id ?? 'qwen-max'
  return {
    enabled: true,
    apiKeyId: (provider['apiKeyEnv'] as string) ?? ALIYUN_KEY_ID,
    model,
    modelLabel: models[0]?.name ?? model
  }
}

/** 保存：Key 入加密库，配置入官方 settings.yaml（llm-aliyun 段） */
export function saveAliyunConfig(apiKey: string | null, model: string): AliyunConfig {
  if (apiKey) {
    setCredential(ALIYUN_KEY_ID, '阿里百炼 DashScope', apiKey)
  }
  const doc = readYaml()
  const label = ALIYUN_MODELS.find((m) => m.id === model)?.name ?? model
  doc['llm-aliyun'] = {
    providers: {
      aliyun: {
        displayName: '阿里百炼',
        apiKeyEnv: ALIYUN_KEY_ID,
        api: 'openai-completions',
        baseURL: ALIYUN_BASE_URL,
        models: [{ id: model, name: label }]
      }
    }
  }
  writeYaml(doc)
  return { enabled: true, apiKeyId: ALIYUN_KEY_ID, model, modelLabel: label }
}

export function hasAliyunKey(): boolean {
  return readCredential(ALIYUN_KEY_ID) !== null
}

export interface AliyunTestResult {
  ok: boolean
  latencyMs: number
  model: string
  reply: string | null
  error: string | null
}

/** 真实对话测试：向 DashScope 发一条消息并取回复 */
export async function testAliyunConnection(model: string, prompt = '请用一句话回答：1+1等于几？'): Promise<AliyunTestResult> {
  const key = readCredential(ALIYUN_KEY_ID)
  if (!key) {
    return { ok: false, latencyMs: 0, model, reply: null, error: '未配置 API Key，请先保存阿里百炼密钥' }
  }
  const started = Date.now()
  try {
    const res = await fetch(`${ALIYUN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200
      }),
      signal: AbortSignal.timeout(30_000)
    })
    const latencyMs = Date.now() - started
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, latencyMs, model, reply: null, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const reply = data.choices?.[0]?.message?.content ?? null
    return { ok: true, latencyMs, model, reply, error: null }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      model,
      reply: null,
      error: (err as Error).message
    }
  }
}
