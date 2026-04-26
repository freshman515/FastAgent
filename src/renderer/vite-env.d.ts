/// <reference types="vite/client" />

import type { HTMLAttributes, JSX as ReactJSX } from 'react'
import type { ElectronAPI } from '../preload/index'

declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    type ElementType = ReactJSX.ElementType
    interface ElementClass extends ReactJSX.ElementClass {}
    interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends ReactJSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {
      webview: HTMLAttributes<HTMLElement> & {
        src?: string
        partition?: string
        webpreferences?: string
        allowpopups?: string | boolean
      }
    }
  }

  interface Window {
    api: ElectronAPI
  }
}
