import { useEffect, useState } from 'react'
import { Section, Card, GroupLabel } from '../../components/settings/common'

const LS = {
  size: 'kimi-desktop:codeview:font-size',
  wrap: 'kimi-desktop:codeview:wrap',
  lines: 'kimi-desktop:codeview:line-numbers'
}

const SIZES = [12, 13, 14, 15] as const

function loadNum(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key))
  return SIZES.includes(v as (typeof SIZES)[number]) ? v : fallback
}

function loadBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key)
  return v == null ? fallback : v === 'true'
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
          checked ? 'left-[19px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

export function CodePreviewSettings() {
  const [size, setSize] = useState(() => loadNum(LS.size, 13))
  const [wrap, setWrap] = useState(() => loadBool(LS.wrap, false))
  const [lines, setLines] = useState(() => loadBool(LS.lines, false))

  // 持久化并立即生效:写入 CSS 变量,由下方注入的 <style> 应用到 .markdown-body pre
  useEffect(() => {
    document.documentElement.style.setProperty('--code-font-size', `${size}px`)
    document.documentElement.style.setProperty('--code-white-space', wrap ? 'pre-wrap' : 'pre')
    localStorage.setItem(LS.size, String(size))
    localStorage.setItem(LS.wrap, String(wrap))
    localStorage.setItem(LS.lines, String(lines))
  }, [size, wrap, lines])

  return (
    <Section title="代码预览" desc="聊天中代码块的显示偏好,立即生效于新渲染的代码块">
      <style>{`.markdown-body pre{font-size:var(--code-font-size,13px);white-space:var(--code-white-space,pre)}`}</style>

      <GroupLabel>显示偏好</GroupLabel>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium">字号</p>
            <p className="text-[12px] text-text-tertiary">代码块内文字的显示大小</p>
          </div>
          <div className="inline-flex gap-0.5 rounded-lg border border-border p-0.5">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`rounded-md px-2.5 py-1 text-[12.5px] transition-colors ${
                  size === s
                    ? 'bg-primary font-medium text-white'
                    : 'text-text-secondary hover:bg-surface-tertiary'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="my-3 border-t border-border-light" />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium">自动换行</p>
            <p className="text-[12px] text-text-tertiary">长行自动折行,无需横向滚动</p>
          </div>
          <Switch checked={wrap} onChange={setWrap} />
        </div>

        <div className="my-3 border-t border-border-light" />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium">行号</p>
            <p className="text-[12px] text-text-tertiary">预留选项,当前版本暂不渲染行号</p>
          </div>
          <Switch checked={lines} onChange={setLines} />
        </div>
      </Card>

      <GroupLabel>实时预览</GroupLabel>
      <Card>
        <div className="markdown-body">
          <pre>
            <code>{`function greet(name) {\n  return \`Hello, \${name}!\`\n}`}</code>
          </pre>
        </div>
      </Card>
    </Section>
  )
}
