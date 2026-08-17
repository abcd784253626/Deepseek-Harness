/**
 * <webview> 自定义元素类型声明（Electron webview tag）
 */
import type * as React from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        nodeintegration?: string
        webpreferences?: string
      }
    }
  }
}
