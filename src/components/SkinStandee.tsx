/**
 * SkinStandee: 界面皮肤立绘(实验性功能)。
 * 挂在 ShellHome 内容区右下,z-0 垫底、不拦截点击;
 * 设置/统计页与对话占位页透出(内容卡片不透明,保持可读),对话 iframe 不透明天然遮盖。
 * 素材来自皮肤注册表(./skins:内置 src/assets/skins/ + 用户自选 <config_dir>/skins/),
 * 开关与选中皮肤存 desktop-config.json 的 skin_enabled/skin_slug,
 * 经 skin:config-changed 事件即时显隐与切换。
 */
import { useEffect, useState } from 'react'
import type { SkinConfig } from '../platform/kimi-api'
import { BUILTIN_SKINS, listAllSkins, resolveSkin, type SkinInfo } from './skins'

export function SkinStandee() {
  const [cfg, setCfg] = useState<SkinConfig>({ enabled: false, slug: null, opacity: 82, inChat: false })
  // 皮肤列表:内置先行(立即可用),自选扫描结果到达后合并
  const [skins, setSkins] = useState<SkinInfo[]>(BUILTIN_SKINS)

  useEffect(() => {
    window.kimiApi
      .skinConfigGet()
      .then(setCfg)
      .catch(() => {})
    listAllSkins()
      .then(setSkins)
      .catch(() => {})
    return window.kimiApi.onSkinConfigChanged(setCfg)
  }, [])

  // 开关与不透明度同步到 body:theme.css 据此把 skin-card 卡片切为半透毛玻璃
  useEffect(() => {
    document.body.classList.toggle('skin-on', cfg.enabled)
    document.body.style.setProperty('--skin-card-opacity', String(cfg.opacity / 100))
    return () => {
      document.body.classList.remove('skin-on')
      document.body.style.removeProperty('--skin-card-opacity')
    }
  }, [cfg.enabled, cfg.opacity])

  const skin = cfg.enabled ? resolveSkin(skins, cfg.slug) : null
  if (!skin) return null
  return (
    <div className="pointer-events-none absolute bottom-0 right-6 z-0 h-[72%] select-none">
      <img src={skin.url} alt="" className="h-full w-auto" draggable={false} />
    </div>
  )
}
