/**
 * 安全模块
 * - API Key 使用 Electron safeStorage（Windows DPAPI）加密后落盘
 * - 渲染进程的一切文件读写都经主进程此模块鉴权（拒绝路径穿越）
 */
import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { CredentialEntry } from '@shared/types'

const CRED_FILE = 'credentials.enc.json'

function credPath(): string {
  const { app } = require('electron') as typeof import('electron')
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, CRED_FILE)
}

interface StoredCredential {
  label: string
  /** safeStorage 加密后的 base64 */
  cipher: string
  updatedAt: number
}

function readAll(): Record<string, StoredCredential> {
  const path = credPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, StoredCredential>
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, StoredCredential>): void {
  writeFileSync(credPath(), JSON.stringify(map, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

function encrypt(plain: string): string {
  // safeStorage 不可用时（Linux 无 keyring 等）退化为 base64 并标记；Windows 上始终可用
  if (!safeStorage.isEncryptionAvailable()) {
    return `plain:${Buffer.from(plain, 'utf-8').toString('base64')}`
  }
  return safeStorage.encryptString(plain).toString('base64')
}

function decrypt(cipher: string): string {
  if (cipher.startsWith('plain:')) {
    return Buffer.from(cipher.slice(6), 'base64').toString('utf-8')
  }
  return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
}

/** 读取明文（仅主进程内部使用，绝不通过 IPC 下发明文） */
export function readCredential(key: string): string | null {
  const entry = readAll()[key]
  if (!entry) return null
  try {
    return decrypt(entry.cipher)
  } catch {
    return null
  }
}

export function setCredential(key: string, label: string, value: string): CredentialEntry {
  const all = readAll()
  all[key] = { label, cipher: encrypt(value), updatedAt: Date.now() }
  writeAll(all)
  return { key, label, hasValue: true, updatedAt: all[key].updatedAt }
}

export function removeCredential(key: string): void {
  const all = readAll()
  delete all[key]
  writeAll(all)
}

export function listCredentials(): CredentialEntry[] {
  return Object.entries(readAll()).map(([key, v]) => ({
    key,
    label: v.label,
    hasValue: true,
    updatedAt: v.updatedAt
  }))
}

/**
 * 路径安全校验：任何来自渲染进程的路径必须落在这批允许的根目录内。
 * 用于阻止任意文件读写。
 */
export function assertPathInside(root: string, candidate: string): string {
  const normalizedRoot = resolve(root).replace(/[\\/]+$/, '')
  const target = resolve(candidate)
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) {
    throw new Error(`拒绝访问工作区之外的路径: ${candidate}`)
  }
  return target
}
