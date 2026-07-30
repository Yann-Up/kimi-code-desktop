import { useEffect, useState } from 'react'
import { Library } from 'lucide-react'
import { Section, Card } from '../../components/settings/common'

interface AppInfo {
  cliVersion: string | null
}

export function IndexSettings() {
  const [cli, setCli] = useState<string | null>(null)

  useEffect(() => {
    window.kimiApi
      .appInfo()
      .then((i) => setCli((i as AppInfo).cliVersion ?? null))
      .catch(() => {})
  }, [])

  return (
    <Section title="索引库" desc="工作区代码索引的构建与管理">
      <Card className="py-12 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-tertiary text-text-tertiary">
          <Library size={22} />
        </span>
        <p className="mt-3 text-[14px] font-medium">索引库功能暂未开放</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-text-tertiary">
          当前 CLI 版本({cli ?? '0.29.2'})暂未开放此能力的接口,后续版本接入
        </p>
      </Card>
    </Section>
  )
}
