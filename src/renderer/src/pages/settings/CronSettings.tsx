import { useEffect, useState } from 'react'
import { CalendarClock, Clock, FileJson } from 'lucide-react'
import { Section, Card, GroupLabel, Empty } from '../../components/settings/common'

interface CronEntry {
  sessionId: string
  file: string
  data: Record<string, unknown>
}

/** 依次尝试若干键,返回第一个非空字符串 */
function pickStr(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** 下次触发时间:兼容字符串与时间戳数字 */
function pickNext(data: Record<string, unknown>): string | undefined {
  const keys = ['next_run', 'nextRun', 'next_trigger', 'nextTrigger', 'next_run_at', 'nextRunAt']
  const s = pickStr(data, keys)
  if (s) return s
  for (const k of keys) {
    const v = data[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      const d = new Date(v > 1e12 ? v : v * 1000)
      if (!Number.isNaN(d.getTime())) return d.toLocaleString()
    }
  }
  return undefined
}

function promptOf(data: Record<string, unknown>): string | undefined {
  const direct = pickStr(data, ['prompt', 'message', 'task', 'instruction', 'content'])
  if (direct) return direct
  const payload = data.payload
  if (payload && typeof payload === 'object') {
    return pickStr(payload as Record<string, unknown>, ['prompt', 'message', 'task', 'instruction'])
  }
  return undefined
}

export function CronSettings() {
  const [jobs, setJobs] = useState<CronEntry[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.kimiApi
      .localCron()
      .then((j) => {
        setJobs(Array.isArray(j) ? (j as CronEntry[]) : [])
        setErr('')
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : '读取定时任务失败'))
  }, [])

  return (
    <Section title="定时任务" desc="由 Kimi 在会话中创建的本地定时任务(只读)">
      <GroupLabel>任务列表</GroupLabel>
      {err && <p className="text-[12px] text-danger">{err}</p>}
      {jobs && jobs.length === 0 && !err && (
        <Empty text="暂无定时任务,可在会话中让 Kimi 创建定时提醒" />
      )}
      {(jobs ?? []).map((job, i) => {
        const schedule = pickStr(job.data, [
          'schedule',
          'cron',
          'cron_expression',
          'cronExpression',
          'pattern',
          'expr'
        ])
        const human = pickStr(job.data, [
          'schedule_human',
          'scheduleHuman',
          'human',
          'human_readable',
          'readable',
          'description'
        ])
        const prompt = promptOf(job.data)
        const next = pickNext(job.data)
        return (
          <Card key={`${job.sessionId}-${job.file}-${i}`} className="transition-colors hover:border-primary-border">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Clock size={15} />
              </span>
              <span className="font-mono text-[13px] font-medium">{schedule ?? job.file}</span>
              {human && (
                <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[12px] text-primary">
                  {human}
                </span>
              )}
            </div>
            {prompt && (
              <p className="mt-2 line-clamp-2 text-[13px] text-text-secondary">{prompt}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-tertiary">
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={12} />
                {next ? `下次触发:${next}` : '下次触发时间未知'}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <FileJson size={12} />
                会话:
                <span className="truncate font-mono" title={job.sessionId}>
                  {job.sessionId.slice(0, 12)}…
                </span>
              </span>
            </div>
          </Card>
        )
      })}
    </Section>
  )
}
