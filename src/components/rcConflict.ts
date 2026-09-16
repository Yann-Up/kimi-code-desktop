/**
 * RC(Remote Control)单例冲突的结构化错误解析。
 * 与 Rust 侧 server.rs 的标记格式对应:`RC_CONFLICT|pid=<pid>|origin=<origin>`。
 * 标记可能出现在整串中部(App/ShellHome 会给它加"后端服务意外退出:"等前缀),按 indexOf 定位
 */

export interface RcConflictInfo {
  pid: number
  origin: string
}

export function parseRcConflict(message: string | null | undefined): RcConflictInfo | null {
  if (!message) return null
  const i = message.indexOf('RC_CONFLICT|')
  if (i < 0) return null
  const fields = message.slice(i).split('|')
  // fields: ['RC_CONFLICT', 'pid=<n>', 'origin=<url>', ...](多余字段忽略,防未来扩展破坏解析)
  let pid = 0
  let origin = ''
  for (const f of fields.slice(1)) {
    if (f.startsWith('pid=')) pid = Number(f.slice(4))
    else if (f.startsWith('origin=')) origin = f.slice(7)
    else break
  }
  return pid > 0 ? { pid, origin } : null
}
