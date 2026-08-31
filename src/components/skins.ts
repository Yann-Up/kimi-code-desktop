/**
 * 皮肤注册表(实验性皮肤立绘)。
 * 内置:构建时扫描 src/assets/skins/ 下的图片并打包,slug = 文件名(去扩展名),
 *   往该目录丢图即新增一个内置皮肤,无需改代码。
 * 自选:运行期扫描 <config_dir>/skins/(Rust skin_custom_list),经 skin:// 协议供图。
 * 内置在前、自选在后;slug 冲突时内置优先。Rust 不感知注册表,
 * 未知 slug 一律回退列表第一个(与 pet_active_get 的回退策略一致)。
 */

import { customProtocolUrl } from '../platform/protocol'

/** 单个皮肤:slug 来自文件名;url 内置为打包资源地址,自选为 skin:// 协议地址 */
export interface SkinInfo {
  slug: string
  /** 展示名(目前即 slug;后续可多语言/别名表) */
  name: string
  url: string
  /** 来源:builtin(安装包内置)/ custom(用户自选) */
  source: 'builtin' | 'custom'
}

const modules = import.meta.glob<string>('../assets/skins/*.{png,webp,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default'
})

export const BUILTIN_SKINS: SkinInfo[] = Object.entries(modules)  .map(([path, url]) => {
    const slug = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
    return { slug, name: slug, url, source: 'builtin' as const }
  })
  .sort((a, b) => a.slug.localeCompare(b.slug))

/** 用户自选皮肤的供图 URL(skin:// 协议,Rust 侧按 slug 读 <config_dir>/skins/) */
function customSkinUrl(slug: string): string {
  return customProtocolUrl('skin', slug)
}

/** 合并皮肤列表:内置在前,其后为用户自选(与内置 slug 冲突的自选跳过,内置优先) */
export async function listAllSkins(): Promise<SkinInfo[]> {
  const custom = await window.kimiApi.skinCustomList().catch(() => [] as string[])
  const customInfos: SkinInfo[] = custom
    .filter((slug) => !BUILTIN_SKINS.some((b) => b.slug === slug))
    .map((slug) => ({ slug, name: slug, url: customSkinUrl(slug), source: 'custom' as const }))
  return [...BUILTIN_SKINS, ...customInfos]
}

/** 按 slug 在列表里取皮肤;未设置/未知 slug 回退列表第一个,空列表返回 null */
export function resolveSkin(list: SkinInfo[], slug: string | null | undefined): SkinInfo | null {
  if (list.length === 0) return null
  return list.find((s) => s.slug === slug) ?? list[0]
}
