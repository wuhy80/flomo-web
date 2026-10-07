/**
 * The format toolbar's buttons: flomo's row, `#` image | Aa lists task table,
 * with the Aa menu's open state kept locally.
 *
 * @module @flomo/ui/FormatTools
 */

import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import type { FormatTools } from './format-tools.ts'

/** Props of {@link FormatToolsBar}: the bound transforms and an optional image slot. */
export interface FormatToolsBarProps {
  tools: FormatTools
  /** Rendered between the tag and divider — the composer parks its image picker there. */
  imageSlot?: React.ReactNode
}

/**
 * The button row: `#` image | Aa lists task table, flomo's arrangement.
 * @param props - the bound transforms and an optional image slot.
 * @returns the toolbar element.
 */
export function FormatToolsBar({ tools, imageSlot }: FormatToolsBarProps): React.ReactElement {
  const [aaOpen, setAaOpen] = useState(false)
  const aaWrap = useRef<HTMLSpanElement>(null)

  // The Aa menu closes on any click outside its anchor.
  useEffect(() => {
    if (!aaOpen) return undefined
    const close = (event: PointerEvent) => {
      if (aaWrap.current && !aaWrap.current.contains(event.target as Node)) {
        setAaOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [aaOpen])

  const applyFormat = (kind: 'bold' | 'underline' | 'mark'): void => {
    if (kind === 'bold') tools.wrapSelection('**', '**')
    else if (kind === 'underline') tools.wrapSelection('<u>', '</u>')
    else tools.wrapSelection('==', '==')
    setAaOpen(false)
  }

  return (
    <span className="fl-composer-tools">
      <button type="button" className="fl-tool" title="插入标签" onClick={() => tools.insertTagStart()}>
        #
      </button>
      {imageSlot}
      <span className="fl-tool-divider" aria-hidden="true" />
      <span className="fl-aa-wrap" ref={aaWrap}>
        <button
          type="button"
          className="fl-tool fl-tool-text"
          title="文字格式"
          aria-expanded={aaOpen}
          onClick={() => setAaOpen((open) => !open)}
        >
          Aa
        </button>
        {aaOpen ? (
          <span className="fl-aa-menu">
            <button type="button" className="fl-aa-option" title="加粗" onClick={() => applyFormat('bold')}>
              <strong>B</strong>
            </button>
            <button type="button" className="fl-aa-option" title="下划线" onClick={() => applyFormat('underline')}>
              <span className="fl-aa-u">U</span>
            </button>
            <button type="button" className="fl-aa-option" title="高亮" onClick={() => applyFormat('mark')}>
              <span className="fl-aa-hl">H</span>
            </button>
          </span>
        ) : null}
      </span>
      <button type="button" className="fl-tool" title="无序列表" onClick={() => tools.toggleList('ul')}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <g fill="currentColor">
            <circle cx="3" cy="4" r="1.1" />
            <circle cx="3" cy="8" r="1.1" />
            <circle cx="3" cy="12" r="1.1" />
          </g>
          <path
            d="M6.5 4h7M6.5 8h7M6.5 12h7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button type="button" className="fl-tool" title="有序列表" onClick={() => tools.toggleList('ol')}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <text x="1" y="5.6" fontSize="5.4" fill="currentColor" fontFamily="inherit">
            1.
          </text>
          <text x="1" y="10.6" fontSize="5.4" fill="currentColor" fontFamily="inherit">
            2.
          </text>
          <text x="1" y="15.6" fontSize="5.4" fill="currentColor" fontFamily="inherit">
            3.
          </text>
          <path
            d="M7.5 4h7M7.5 8.5h7M7.5 13h7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button type="button" className="fl-tool" title="任务清单" onClick={() => tools.toggleList('task')}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="11"
            height="11"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="m5.2 8.2 2 2 3.6-4.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="fl-tool"
        title="插入表格"
        onClick={() => tools.insertTemplate('| 列一 | 列二 |\n| --- | --- |\n|  |  |', 4)}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M2 6.5h12M2 10.5h12M6.5 2v12M10.5 2v12" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </span>
  )
}
