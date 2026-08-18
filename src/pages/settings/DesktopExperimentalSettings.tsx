/**
 * 桌面 · 实验性功能:桌面壳自身的实验性特性(与 CLI 实验性开关互不影响)。
 * 目前只有桌宠(设计见 docs/desktop-pet-design.md)。
 */
import { useEffect, useState } from 'react'
import { Section, Card, GroupLabel } from '../../components/settings/common'
import type { PetInfo } from '../../platform/kimi-api'

export function DesktopExperimentalSettings() {
  // 桌宠:开关状态与写入中标记
  const [petEnabled, setPetEnabled] = useState(false)
  const [petBusy, setPetBusy] = useState(false)
  const [petError, setPetError] = useState('')
  // 当前激活宠物 slug 与可选宠物列表(内置 + 扫描到的外部宠物)
  const [petSlug, setPetSlug] = useState('kimi')
  const [petOptions, setPetOptions] = useState<PetInfo[]>([])

  useEffect(() => {
    window.kimiApi
      .petConfigGet()
      .then((c) => {
        setPetEnabled(c.enabled)
        setPetSlug(c.slug)
      })
      .catch(() => {})
    // 其他页面/窗口改桌宠配置后,同步本页开关与激活宠物
    return window.kimiApi.onPetConfigChanged((c) => {
      setPetEnabled(c.enabled)
      setPetSlug(c.slug)
    })
  }, [])

  // 桌宠开启后加载可选宠物列表(内置 + kimi_home/pets 与 ~/.petdex/pets 扫描结果)
  useEffect(() => {
    if (!petEnabled) return
    window.kimiApi
      .petList()
      .then(setPetOptions)
      .catch((e) => setPetError(e instanceof Error ? e.message : String(e)))
  }, [petEnabled])

  return (
    <Section
      title="实验性功能"
      desc="桌面端自身的实验性特性,可能不稳定,后续版本可能调整或移除;如遇异常关闭对应开关即可"
    >
      <GroupLabel>桌宠</GroupLabel>
      <Card>
        {/* 桌宠:透明置顶悬浮窗,渲染本地 spritesheet */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13.5px] font-medium">桌宠</p>
            <p className="text-[12px] text-text-tertiary">
              在桌面悬浮一只宠物,随 Kimi Code 任务状态切换动作(左键拖动)
            </p>
            {petError && <p className="mt-1 text-[12px] text-danger">{petError}</p>}
          </div>
          <button
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              petEnabled ? 'bg-primary' : 'bg-border'
            } disabled:opacity-50`}
            disabled={petBusy}
            onClick={() => {
              const next = !petEnabled
              setPetBusy(true)
              setPetError('')
              window.kimiApi
                .petSetEnabled(next)
                .then(() => setPetEnabled(next))
                .catch((e) => setPetError(e instanceof Error ? e.message : String(e)))
                .finally(() => setPetBusy(false))
            }}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                petEnabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
        {/* 宠物选择(内置排第一,外部宠物按目录扫描);切换后桌宠窗经 pet:config-changed 重载 */}
        {petEnabled && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">宠物形象</p>
              <p className="text-[12px] text-text-tertiary">
                外部宠物扫描自 kimi-code 数据目录下的 pets/ 与 ~/.petdex/pets/(需含 pet.json 与精灵图),切换即时生效
              </p>
            </div>
            <select
              className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-50"
              value={petSlug}
              disabled={petBusy}
              onChange={(e) => {
                const slug = e.target.value
                setPetError('')
                window.kimiApi
                  .petSetActive(slug)
                  .then(() => setPetSlug(slug))
                  .catch((err) => setPetError(err instanceof Error ? err.message : String(err)))
              }}
            >
              {/* 激活宠物不在扫描结果里(目录被删等)时兜底展示,避免 select 失控 */}
              {!petOptions.some((p) => p.slug === petSlug) && (
                <option value={petSlug}>{petSlug}</option>
              )}
              {petOptions.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>
    </Section>
  )
}
