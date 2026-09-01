/**
 * TomlHighlight: 只读 TOML 高亮视图(源文件卡片的「查看」态;编辑态仍是纯 textarea)。
 * 手写行级 tokenizer,零依赖:注释 / 节头([table]、[[array]])/ 键 / 字符串 / 数字·布尔·日期
 * 五类着色 + 行号槽。色值全部走 theme.css 令牌,亮暗主题自适应。
 */
import type { ReactNode } from 'react'

interface Tok {
  text: string
  cls?: string
}

/** 着色类别 → 令牌类串 */
const C = {
  comment: 'italic text-text-tertiary',
  header: 'font-semibold text-primary',
  key: 'font-medium text-text',
  str: 'text-success',
  num: 'text-warning',
  punct: 'text-text-tertiary'
} as const

/** 在首个不在引号内的 = 处拆 key/value;注释行或纯值行返回 null */
function splitKeyValue(line: string): [string, string] | null {
  let inD = false
  let inS = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inD) {
      if (c === '\\') i++
      else if (c === '"') inD = false
      continue
    }
    if (inS) {
      if (c === "'") inS = false
      continue
    }
    if (c === '"') inD = true
    else if (c === "'") inS = true
    else if (c === '=') return [line.slice(0, i), line.slice(i + 1)]
    else if (c === '#') return null
  }
  return null
}

/** 值部分扫描:字符串(双引号带转义/单引号字面)、行尾注释、标点、数字/布尔/日期 */
function tokenizeValue(v: string, out: Tok[]) {
  let i = 0
  while (i < v.length) {
    const c = v[i]
    if (c === '"') {
      let j = i + 1
      while (j < v.length) {
        if (v[j] === '\\') j += 2
        else if (v[j] === '"') {
          j++
          break
        } else j++
      }
      out.push({ text: v.slice(i, j), cls: C.str })
      i = j
    } else if (c === "'") {
      const j = v.indexOf("'", i + 1)
      const end = j < 0 ? v.length : j + 1
      out.push({ text: v.slice(i, end), cls: C.str })
      i = end
    } else if (c === '#') {
      out.push({ text: v.slice(i), cls: C.comment })
      return
    } else if (/[\[\]{},]/.test(c)) {
      out.push({ text: c, cls: C.punct })
      i++
    } else if (/\s/.test(c)) {
      out.push({ text: c })
      i++
    } else {
      let j = i
      while (j < v.length && !/[\s\[\]{},="'#]/.test(v[j])) j++
      const w = v.slice(i, j)
      const cls =
        w === 'true' || w === 'false' || /^[+-]?[\d_]/.test(w) ? C.num : undefined
      out.push({ text: w, cls })
      i = j
    }
  }
}

function tokenizeLine(line: string): Tok[] {
  if (line.trim() === '') return [{ text: line }]
  if (/^\s*#/.test(line)) return [{ text: line, cls: C.comment }]
  // 节头:[table] / [[array]] / [a."b.c"] 等,剩余部分(尾注释)按值扫
  const hm = line.match(/^(\s*)(\[\[[^\]]*\]\]|\[[^\]]*\])(.*)$/)
  if (hm) {
    const out: Tok[] = []
    if (hm[1]) out.push({ text: hm[1] })
    out.push({ text: hm[2], cls: C.header })
    if (hm[3]) tokenizeValue(hm[3], out)
    return out
  }
  const kv = splitKeyValue(line)
  if (!kv) return [{ text: line }]
  const [k, v] = kv
  const out: Tok[] = [{ text: k, cls: C.key }, { text: '=', cls: C.punct }]
  tokenizeValue(v, out)
  return out
}

export function TomlHighlight({ code, className = '' }: { code: string; className?: string }) {
  const lines = code.split('\n')
  const renderLine = (line: string, i: number): ReactNode => (
    <div key={i} className="whitespace-pre">
      {line === ''
        ? ' '
        : tokenizeLine(line).map((tk, j) => (
            <span key={j} className={tk.cls}>
              {tk.text}
            </span>
          ))}
    </div>
  )
  return (
    <div
      className={`flex overflow-auto rounded-lg border border-border bg-surface-secondary font-mono text-[12px] leading-relaxed ${className}`}
    >
      {/* 行号槽:sticky 钉在左侧,横向滚动时保持可见 */}
      <div className="sticky left-0 z-10 shrink-0 select-none border-r border-border-light bg-surface-secondary px-2 py-3 text-right text-text-tertiary/50">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="min-w-0 flex-1 p-3">{lines.map(renderLine)}</pre>
    </div>
  )
}
