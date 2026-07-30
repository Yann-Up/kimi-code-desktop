import { useEffect, useState } from 'react'
import { Brain } from 'lucide-react'
import { Section, Card } from '../../components/settings/common'

interface AppInfo {
  cliVersion: string | null
}

export function MemorySettings() {
  const [cli, setCli] = useState<string | null>(null)

  useEffect(() => {
    window.kimiApi
      .appInfo()
      .then((i) => setCli((i as AppInfo).cliVersion ?? null))
      .catch(() => {})
  }, [])

  return (
    <Section title="记忆" desc="跨会话的长期记忆管理">
      <Card className="py-12 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-tertiary text-text-tertiary">
          <Brain size={22} />
        </span>
        <p className="mt-3 text-[14px] font-medium">记忆功能暂未开放</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-text-tertiary">
          当前 CLI 版本({cli ?? '0.29.2'})暂未开放此能力的接口,后续版本接入
        </p>
      </Card>
    </Section>
  )
}
