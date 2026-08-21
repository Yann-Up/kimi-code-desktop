/**
 * 桌面 · 实验性功能:桌面壳自身的实验性特性(与 CLI 实验性开关互不影响)。
 * 目前有桌宠(设计见 docs/desktop-pet-design.md)与皮肤立绘(注册表见 components/skins.ts)。
 */
import { useEffect, useState } from 'react'
import { Section, Card, GroupLabel } from '../../components/settings/common'
import { listAllSkins, resolveSkin, type SkinInfo } from '../../components/skins'
import type { PetInfo } from '../../platform/kimi-api'

export function DesktopExperimentalSettings() {
  // 桌宠:开关状态与写入中标记
  const [petEnabled, setPetEnabled] = useState(false)
  const [petBusy, setPetBusy] = useState(false)
  const [petError, setPetError] = useState('')
  // 当前激活宠物 slug 与可选宠物列表(内置 + 扫描到的外部宠物)
  const [petSlug, setPetSlug] = useState('kimi')
  const [petOptions, setPetOptions] = useState<PetInfo[]>([])
  // 点击穿透:开启后桌宠忽略鼠标事件(无法拖动/右键,只能回本页关闭)
  const [petClickThrough, setPetClickThrough] = useState(false)
  // 皮肤立绘:开关状态、当前皮肤 slug(null = 注册表第一个)与写入中标记
  const [skinEnabled, setSkinEnabled] = useState(false)
  const [skinSlug, setSkinSlug] = useState<string | null>(null)
  const [skinBusy, setSkinBusy] = useState(false)
  const [skinError, setSkinError] = useState('')
  // 可选皮肤列表(内置 + 自选,开启时加载)
  const [skinOptions, setSkinOptions] = useState<SkinInfo[]>([])
  // 卡片不透明度(30-100,缺省 82;与 Rust skin::DEFAULT_OPACITY 对齐)
  const [skinOpacity, setSkinOpacity] = useState(82)
  // 对话页内透出立绘(实验性,缺省关;注入脚本 + chatSkinBridge 桥接)
  const [skinInChat, setSkinInChat] = useState(false)

  useEffect(() => {
    window.kimiApi
      .petConfigGet()
      .then((c) => {
        setPetEnabled(c.enabled)
        setPetSlug(c.slug)
        setPetClickThrough(c.clickThrough)
      })
      .catch(() => {})
    // 其他页面/窗口改桌宠配置后,同步本页开关与激活宠物
    const offPet = window.kimiApi.onPetConfigChanged((c) => {
      setPetEnabled(c.enabled)
      setPetSlug(c.slug)
      setPetClickThrough(c.clickThrough)
    })
    window.kimiApi
      .skinConfigGet()
      .then((c) => {
        setSkinEnabled(c.enabled)
        setSkinSlug(c.slug)
        setSkinOpacity(c.opacity)
        setSkinInChat(c.inChat)
      })
      .catch(() => {})
    // 皮肤配置经 skin:config-changed 广播,同步本页(立绘显隐由 SkinStandee 自行监听)
    const offSkin = window.kimiApi.onSkinConfigChanged((c) => {
      setSkinEnabled(c.enabled)
      setSkinSlug(c.slug)
      setSkinOpacity(c.opacity)
      setSkinInChat(c.inChat)
    })
    return () => {
      offPet()
      offSkin()
    }
  }, [])

  // 桌宠开启后加载可选宠物列表(内置 + 应用数据目录/kimi_home/pets/~/.petdex/pets 扫描结果)
  useEffect(() => {
    if (!petEnabled) return
    window.kimiApi
      .petList()
      .then(setPetOptions)
      .catch((e) => setPetError(e instanceof Error ? e.message : String(e)))
  }, [petEnabled])

  // 皮肤开启后加载可选皮肤列表(内置 + 扫描 <config_dir>/skins/ 的自选图片)
  useEffect(() => {
    if (!skinEnabled) return
    listAllSkins()
      .then(setSkinOptions)
      .catch((e) => setSkinError(e instanceof Error ? e.message : String(e)))
  }, [skinEnabled])

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
                外部宠物扫描自应用数据目录的 pets/(导入的宠物存这里)、kimi-code 数据目录与 ~/.petdex/pets/(需含 pet.json 与精灵图);切换即时生效
              </p>
              <p className="text-[12px] text-text-tertiary">
                导入 zip 时,目录名与显示名优先取 pet.json 的 slug/id/displayName/name 字段,这些字段都没有时才用 zip 文件名
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* 导入宠物包:zip 字节传 Rust 解压校验到应用数据目录 pets/<slug>,成功后直接换上 */}
              <label
                className={`cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-secondary hover:border-primary/50 ${
                  petBusy ? 'pointer-events-none opacity-50' : ''
                }`}
              >
                导入 zip
                <input
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    // 清空 value 允许重复选同一文件
                    e.target.value = ''
                    if (!f) return
                    if (f.size > 32 * 1024 * 1024) {
                      setPetError('宠物包过大(上限 32MB)')
                      return
                    }
                    setPetBusy(true)
                    setPetError('')
                    try {
                      const bytes = Array.from(new Uint8Array(await f.arrayBuffer()))
                      const info = await window.kimiApi.petImportZip(f.name, bytes)
                      setPetOptions(await window.kimiApi.petList())
                      await window.kimiApi.petSetActive(info.slug)
                      setPetSlug(info.slug)
                    } catch (err) {
                      setPetError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setPetBusy(false)
                    }
                  }}
                />
              </label>
              <select
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-50"
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
          </div>
        )}
        {/* 点击穿透:开启后桌宠不响应鼠标(挡视线时用);只能回本页关闭,故文案里写明 */}
        {petEnabled && (
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">点击穿透</p>
              <p className="text-[12px] text-text-tertiary">
                开启后鼠标直接穿过桌宠(无法拖动或右键),需回本页关闭
              </p>
            </div>
            <button
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                petClickThrough ? 'bg-primary' : 'bg-border'
              } disabled:opacity-50`}
              disabled={petBusy}
              onClick={() => {
                const next = !petClickThrough
                setPetBusy(true)
                setPetError('')
                window.kimiApi
                  .petSetClickThrough(next)
                  .then(() => setPetClickThrough(next))
                  .catch((e) => setPetError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setPetBusy(false))
              }}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  petClickThrough ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        )}
      </Card>
      <GroupLabel>皮肤</GroupLabel>
      <Card>
        {/* 皮肤立绘:主页/统计/设置页右侧显示内置立绘(SkinStandee),对话 iframe 不生效 */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13.5px] font-medium">背景立绘</p>
            <p className="text-[12px] text-text-tertiary">
              在主页、统计、设置页右侧显示内置立绘(对话页不生效)
            </p>
            {skinError && <p className="mt-1 text-[12px] text-danger">{skinError}</p>}
          </div>
          <button
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              skinEnabled ? 'bg-primary' : 'bg-border'
            } disabled:opacity-50`}
            disabled={skinBusy}
            onClick={() => {
              const next = !skinEnabled
              setSkinBusy(true)
              setSkinError('')
              window.kimiApi
                .skinSetEnabled(next)
                .then(() => setSkinEnabled(next))
                .catch((e) => setSkinError(e instanceof Error ? e.message : String(e)))
                .finally(() => setSkinBusy(false))
            }}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                skinEnabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
        {/* 皮肤选择(内置 + 自选);切换后立绘经 skin:config-changed 即时换图 */}
        {skinEnabled && skinOptions.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* 当前皮肤小预览(立绘全身像,定高截取即可) */}
              <img
                src={resolveSkin(skinOptions, skinSlug)?.url}
                alt=""
                className="h-16 w-auto shrink-0 rounded-lg border border-border-light"
                draggable={false}
              />
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">皮肤形象</p>
                <p className="text-[12px] text-text-tertiary">
                  除内置皮肤外,也可把自己的图片(png/webp/jpg)放进皮肤目录使用,
                  <button
                    className="text-primary hover:underline"
                    onClick={() => {
                      setSkinError('')
                      window.kimiApi
                        .skinDirOpen()
                        .catch((err) =>
                          setSkinError(err instanceof Error ? err.message : String(err))
                        )
                    }}
                  >
                    打开皮肤目录
                  </button>
                  ;放入后重开本页即可选择
                </p>
              </div>
            </div>
            <select
              className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-50"
              value={resolveSkin(skinOptions, skinSlug)?.slug}
              disabled={skinBusy}
              onChange={(e) => {
                const slug = e.target.value
                setSkinError('')
                window.kimiApi
                  .skinSetActive(slug)
                  .then(() => setSkinSlug(slug))
                  .catch((err) => setSkinError(err instanceof Error ? err.message : String(err)))
              }}
            >
              {skinOptions.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                  {s.source === 'custom' ? '(自选)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* 卡片不透明度:拖动即持久化并发 skin:config-changed,SkinStandee 即时更新 CSS 变量 */}
        {skinEnabled && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">卡片不透明度</p>
              <p className="text-[12px] text-text-tertiary">
                数值越低,立绘从卡片下透出越明显(30% - 100%)
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="range"
                min={30}
                max={100}
                value={skinOpacity}
                disabled={skinBusy}
                className="w-40 accent-primary disabled:opacity-50"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setSkinOpacity(v)
                  setSkinError('')
                  window.kimiApi
                    .skinSetOpacity(v)
                    .catch((err) =>
                      setSkinError(err instanceof Error ? err.message : String(err))
                    )
                }}
              />
              <span className="w-10 text-right text-[13px] tabular-nums text-text-secondary">
                {skinOpacity}%
              </span>
            </div>
          </div>
        )}
        {/* 对话页内透出:经注入脚本把立绘挂进官方 web UI iframe 右下(chatSkinBridge 桥接) */}
        {skinEnabled && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">对话页内显示立绘</p>
              <p className="text-[12px] text-text-tertiary">
                在对话窗口(官方 web UI)右下角叠加显示当前皮肤立绘
              </p>
            </div>
            <button
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                skinInChat ? 'bg-primary' : 'bg-border'
              } disabled:opacity-50`}
              disabled={skinBusy}
              onClick={() => {
                const next = !skinInChat
                setSkinBusy(true)
                setSkinError('')
                window.kimiApi
                  .skinSetInChat(next)
                  .then(() => setSkinInChat(next))
                  .catch((e) => setSkinError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSkinBusy(false))
              }}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  skinInChat ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        )}
      </Card>
    </Section>
  )
}
