/**
 * PetWindow: 桌宠悬浮窗的渲染入口(?window=pet)。
 * canvas 逐帧绘制 spritesheet;状态行序与 petdex 约定一致(见 docs/desktop-pet-design.md)。
 * M3:动画元数据经 petActiveGet() 动态加载;内置宠物用打包 import 图,外部宠物走 http://pet.localhost/<slug>。
 * M4 显示优先级:dragState(拖拽方向)> oneshot(点击 waving / pet:tool 脉冲)> rustState(状态机)。
 * 前两层是本地状态,不进 Rust;气泡为纯前端文本层,与动画解耦。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Check, ChevronRight, EyeOff, MousePointerClick, PawPrint } from 'lucide-react'
import type { PetAnim, PetConfig, PetInfo, PetMeta, PetState } from '@/platform/kimi-api'

/** 内置宠物精灵图注册表:slug → 打包资源 URL(src/assets/pets/<slug>/spritesheet.{png,webp}) */
const BUILTIN_SHEETS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../assets/pets/*/spritesheet.{png,webp}', {
      eager: true,
      query: '?url',
      import: 'default'
    })
  ).map(([path, url]) => {
    const m = path.match(/pets\/([^/]+)\/spritesheet\./)
    return [m?.[1] ?? '', url as string]
  })
)
/** 内置宠物取图:slug 未命中(注册表与资产不一致)时回退 kimi 团子 */
function builtinSheetUrl(slug: string): string {
  return BUILTIN_SHEETS[slug] ?? BUILTIN_SHEETS['kimi'] ?? ''
}

/** 工具脉冲气泡文案(display.kind → 候选短句,随机取一;服务端 schema 已核实取值集合) */
const TOOL_BUBBLE: Record<string, string[]> = {
  command: ['让子弹飞一会儿…', '这串命令我熟', '终端,启动!'],
  file_io: ['翻翻看…', '这页我帮你读了', '文件山我来了'],
  diff: ['动两笔…', '代码美容中', '就改亿点点'],
  search: ['搜搜看…', '蛛丝马迹别跑', '让我翻翻故纸堆'],
  url_fetch: ['去网上冲浪一下', '让我康康这个链接'],
  agent_call: ['摇人了摇人了', '叫个外援来帮忙'],
  skill_call: ['掏出我的绝活', '这招我练过'],
  other: ['干活中,勿扰', '埋头苦干ing']
}
/** 状态跃迁气泡(rustState 变化时;idle/running/review 不打岔)。
 * jumping 无条目(M5 P2):turn.ended 成功的庆祝气泡改由 Rust 侧 pet:bubble
 * 概要气泡(耗时+工具数)承载,避免两个文案在单槽气泡里互相覆盖 */
const STATE_BUBBLE: Partial<Record<PetState, string[]>> = {
  failed: ['啊这…翻车了', '出错了,快看看我', '尴尬了…'],
  waiting: ['等你拍板呢', '审批一下嘛', '戳我没用,去点确认呀'],
  // M5 P5 时长显示态提示(各只有一句,随机取一即固定)
  tired: ['跑了好久了,喝口水吧'],
  sleep: ['zzz…']
}
/** 拖拽方向判定的最小位移(px);停手多久算拖拽结束(ms) */
const DRAG_DELTA = 4
const DRAG_END_MS = 300
/** 点击判定:位移 < 5px 且按下时长 < 300ms */
const CLICK_DIST = 5
const CLICK_MS = 300
/** 双击判定(M5 P1):两次点击间隔 < 300ms */
const DBLCLICK_MS = 300
/** 气泡停留时长 */
const BUBBLE_MS = 4000
/** M5 P5 闲置散步:触发间隔随机区间(ms)、单次位移随机区间(逻辑 px)、
 * 散步动画清除延时(比拖拽的 DRAG_END_MS 长一点,覆盖整段移动) */
const WANDER_MIN_MS = 30_000
const WANDER_MAX_MS = 60_000
const WANDER_MIN_PX = 100
const WANDER_MAX_PX = 300
const WANDER_ANIM_MS = 600

/** M5 P5 时段彩蛋:按本地小时取一句问候语 */
function greetingByHour(h: number): string {
  if (h >= 23 || h < 5) return '还不睡啊…'
  if (h < 9) return '早啊'
  if (h < 12) return '上午好,开工?'
  if (h < 14) return '午饭时间'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 状态行解析:精确匹配 → running(方向/工具/tired 扩展行的兜底)→ idle(sleep 走这里) */
function resolveAnim(meta: PetMeta, state: string) {
  const exact = meta.states[state]
  if (exact) return exact
  if (
    state.startsWith('tool:') ||
    state === 'running-left' ||
    state === 'running-right' ||
    state === 'tired'
  ) {
    return meta.states['running'] ?? meta.states['idle']
  }
  return meta.states['idle']
}

/** 候选文案随机取一 */
function pick(texts: string[]): string {
  return texts[Math.floor(Math.random() * texts.length)]
}

/** 有效帧数探测:外部宠物某行的尾部帧可能是空格子(pet.json 未声明帧数时
 * 按行宽兜底),播到空帧会闪空。img 加载后逐格抽样 alpha,遇到首个空帧即截断;
 * 探测失败(如画布被污染)按声明帧数播放,至少保证能显示 */
function detectFrames(img: HTMLImageElement, fw: number, fh: number, anim: PetAnim): number {
  try {
    const probe = document.createElement('canvas')
    probe.width = fw
    probe.height = fh
    const pctx = probe.getContext('2d')
    if (!pctx) return anim.frames
    let n = 0
    for (let i = 0; i < anim.frames; i++) {
      pctx.clearRect(0, 0, fw, fh)
      pctx.drawImage(img, i * fw, anim.row * fh, fw, fh, 0, 0, fw, fh)
      const data = pctx.getImageData(0, 0, fw, fh).data
      let has = false
      // 每 16px 抽一个像素查 alpha,够用且快
      for (let p = 3; p < data.length; p += 64) {
        if (data[p] > 10) {
          has = true
          break
        }
      }
      if (!has) break
      n++
    }
    return Math.max(n, 1)
  } catch {
    return anim.frames
  }
}

/** M5 P4 小跟班:相对主宠帧尺寸的缩放比例;浮动动画的交错间隔(s) */
const MINION_SCALE = 0.45
const MINION_BOB_STAGGER = 0.35

/** M5 P4 子代理小跟班:主宠素材 idle 行的小号副本。独立 canvas + 独立 rAF 循环,
 * bob 浮动走 CSS keyframes——与主渲染循环完全解耦(主循环按 displayed 重建,
 * 小跟班画进同一 canvas 会被 effect 依赖带着反复重启)。取图/crossOrigin 与主渲染一致 */
function MinionSprite({ meta, index }: { meta: PetMeta; index: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const anim = meta.states['idle']
    if (!canvas || !anim) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const fw = meta.frameW
    const fh = meta.frameH
    const dpr = window.devicePixelRatio || 1
    const dw = fw * MINION_SCALE
    const dh = fh * MINION_SCALE
    canvas.width = dw * dpr
    canvas.height = dh * dpr
    const img = new Image()
    // 与主宠同一张图(浏览器缓存命中);crossOrigin=anonymous 与主渲染配套,
    // 否则外部宠物(pet 协议跨源)会污染画布,detectFrames 的 getImageData 抛错
    img.crossOrigin = 'anonymous'
    img.src = meta.source === 'builtin' ? builtinSheetUrl(meta.slug) : `http://pet.localhost/${meta.slug}`
    let raf = 0
    let start = 0
    const draw = (ts: number, frames: number) => {
      if (!start) start = ts
      const idx = Math.floor(((ts - start) / 1000) * anim.fps) % frames
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, dw, dh)
      ctx.drawImage(img, idx * fw, anim.row * fh, fw, fh, 0, 0, dw, dh)
      raf = requestAnimationFrame((t) => draw(t, frames))
    }
    img.onload = () => {
      raf = requestAnimationFrame((t) => draw(t, detectFrames(img, fw, fh, anim)))
    }
    return () => cancelAnimationFrame(raf)
  }, [meta])
  return (
    <canvas
      ref={canvasRef}
      className="pet-minion-bob"
      style={{
        width: meta.frameW * MINION_SCALE,
        height: meta.frameH * MINION_SCALE,
        animationDelay: `${index * MINION_BOB_STAGGER}s`
      }}
    />
  )
}

export function PetWindow() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rustState, setRustState] = useState<PetState>('idle')
  // 拖拽方向(M4):onMoved 期间按 dx 符号给出,停手 DRAG_END_MS 后清除
  const [dragState, setDragState] = useState<PetState | null>(null)
  // 本地一次性动作(M4):'waving'(点击)或 `tool:<kind>`(工具脉冲),播完自动清
  const [oneshot, setOneshot] = useState<string | null>(null)
  // 台词气泡(null 不显示);tone 区分 warn(配额告警等,暖色样式)
  const [bubble, setBubble] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null)
  // M6 菜单可见性(pet:menu-visible):菜单 = 宠物的大气泡,开着期间压制小气泡
  const [menuVisible, setMenuVisible] = useState(false)
  // M5 P4 活跃子代理数(Rust pet:minions;归零也发一次以清除 overlay)
  const [minionCount, setMinionCount] = useState(0)
  // M5 P5 闲置散步开关(petConfigGet / pet:config-changed;缺省开)
  const [wander, setWander] = useState(true)
  // 当前激活宠物的元信息;未加载到时渲染空容器(不报错、不画图)
  const [meta, setMeta] = useState<PetMeta | null>(null)
  // 桌宠配置(右键菜单的点击穿透勾选项与激活宠物高亮用)
  const [petCfg, setPetCfg] = useState<PetConfig | null>(null)
  // 右键菜单(M5,前端自绘):menuAt 为目标位置(null 关闭),menuPos 为实测收边后的落位(null=测量中,先隐藏防闪)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  // 换宠物子菜单(悬停浮出);subTimer 做 200ms 延迟关闭,给鼠标移向子菜单留余量
  const [subOpen, setSubOpen] = useState(false)
  const [petOptions, setPetOptions] = useState<PetInfo[]>([])

  const metaRef = useRef<PetMeta | null>(null)
  metaRef.current = meta
  const menuRef = useRef<HTMLDivElement>(null)
  const subTimer = useRef(0)
  // showBubble 挂在多个空依赖的回调里,菜单可见性要用 ref 读实时值
  const menuVisibleRef = useRef(false)
  menuVisibleRef.current = menuVisible
  const oneshotTimer = useRef(0)
  const bubbleTimer = useRef(0)
  const dragEndTimer = useRef(0)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  // 窗口当前 x(物理 px,onMoved 持续刷新):散步撞边检测用;不像 lastPos 会被清
  const posX = useRef<number | null>(null)
  // 散步方向(1 右 / -1 左),撞边反向
  const wanderDir = useRef(1)
  const pressStart = useRef<{ x: number; y: number; t: number; dragging: boolean } | null>(null)
  // 上一次点击时间戳(M5 P1 双击判定;0 表示无)
  const lastClickAt = useRef(0)

  // 菜单开着时(M6):宠物保持挥手等客——菜单=宠物的大气泡,waving 钉住并循环播放,
  // 菜单关闭自然回落基底。优先级低于拖拽(拖拽开始即收菜单,两态不会共存)
  const displayed: string = dragState ?? (menuVisible ? 'waving' : (oneshot ?? rustState))

  const showBubble = useCallback((text: string, tone: 'info' | 'warn' = 'info') => {
    // M6 互斥:菜单开着(大气泡)期间新气泡直接丢弃,时段问候也走这里一并压制
    if (menuVisibleRef.current) return
    setBubble({ text, tone })
    window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setBubble(null), BUBBLE_MS)
  }, [])

  /** 触发本地一次性动作:按解析出的动画时长播一遍后回基底 */
  const triggerOneshot = useCallback((name: string, bubbleText?: string) => {
    const m = metaRef.current
    if (!m) return
    const anim = resolveAnim(m, name)
    if (!anim) return
    setOneshot(name)
    if (bubbleText) showBubble(bubbleText)
    window.clearTimeout(oneshotTimer.current)
    const ms = Math.max(600, (anim.frames / Math.max(anim.fps, 1)) * 1000)
    oneshotTimer.current = window.setTimeout(() => setOneshot(null), ms)
  }, [showBubble])

  // 透明背景:theme.css 给 html/body/#root 都上了底色,桌宠窗口必须全部穿透
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  // Rust 状态机 emit pet:state;跃迁到 failed/waiting 时带一句气泡
  // (jumping 的庆祝气泡由 pet:bubble 概要气泡承载,见 STATE_BUBBLE 注释)
  useEffect(() => {
    return window.kimiApi.onPetState((s) => {
      setRustState(s)
      const text = STATE_BUBBLE[s]
      if (text) showBubble(pick(text))
    })
  }, [showBubble])

  // M4 工具脉冲:差异化动作(无扩展行则回退 running)+ 气泡文案;Rust 侧已按 kind 1s 节流
  useEffect(() => {
    return window.kimiApi.onPetTool((kind) => {
      triggerOneshot(`tool:${kind}`, pick(TOOL_BUBBLE[kind] ?? TOOL_BUBBLE.other))
    })
  }, [triggerOneshot])

  // M5 P2 信息型气泡(turn 概要/审批详情/配额提醒):Rust 侧已节流,直接进单槽;
  // 后到者优先,审批详情因此能覆盖 waiting 跃迁的通用文案
  useEffect(() => {
    return window.kimiApi.onPetBubble((p) => showBubble(p.text, p.tone))
  }, [showBubble])

  // M5 P4 子代理小跟班计数:纯 overlay 数据源,不进 displayed 优先级链
  useEffect(() => {
    return window.kimiApi.onPetMinions((p) => setMinionCount(p.count))
  }, [])

  // M6 菜单可见性:菜单展开瞬间清掉已显示的气泡(新气泡由 showBubble 入口拦截)
  useEffect(() => {
    return window.kimiApi.onPetMenuVisible((visible) => {
      setMenuVisible(visible)
      if (visible) {
        window.clearTimeout(bubbleTimer.current)
        setBubble(null)
      }
    })
  }, [])

  // M3:加载激活宠物元信息与配置;设置页/右键菜单改配置(pet:config-changed)后重载
  // M5 P5:顺带读闲置散步开关(pet:config-changed 载荷含完整 PetConfig)
  useEffect(() => {
    const reload = () => {
      window.kimiApi
        .petActiveGet()
        .then(setMeta)
        .catch(() => {})
    }
    reload()
    window.kimiApi
      .petConfigGet()
      .then((c) => {
        setPetCfg(c)
        setWander(c.wander)
      })
      .catch(() => {})
    return window.kimiApi.onPetConfigChanged((c) => {
      setPetCfg(c)
      setWander(c.wander)
      reload()
    })
  }, [])

  // 右键菜单打开时刷新宠物列表(外部宠物目录可能变动);关闭时清空收边落位
  useEffect(() => {
    if (!menuAt) return
    window.kimiApi
      .petList()
      .then(setPetOptions)
      .catch(() => {})
  }, [menuAt])

  // 菜单收边:窗口只有 240x250,按实测尺寸把菜单夹回窗口内(先隐藏测量再落位)
  useLayoutEffect(() => {
    if (!menuAt || !menuRef.current) return
    const r = menuRef.current.getBoundingClientRect()
    setMenuPos({
      x: Math.max(4, Math.min(menuAt.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(menuAt.y, window.innerHeight - r.height - 4))
    })
  }, [menuAt, petOptions])

  const closeMenu = useCallback(() => {
    setMenuAt(null)
    setMenuPos(null)
    setSubOpen(false)
  }, [])

  /** 悬停进"换宠物"项或子菜单本体时保持打开 */
  const openSub = useCallback(() => {
    window.clearTimeout(subTimer.current)
    setSubOpen(true)
  }, [])
  /** 移出后 200ms 缓冲再关,给鼠标平移到子菜单留时间(仿原生子菜单手感) */
  const closeSubSoon = useCallback(() => {
    window.clearTimeout(subTimer.current)
    subTimer.current = window.setTimeout(() => setSubOpen(false), 200)
  }, [])
  /** 悬停到主菜单其他项时立即收起子菜单 */
  const closeSubNow = useCallback(() => {
    window.clearTimeout(subTimer.current)
    setSubOpen(false)
  }, [])

  // 自绘菜单补原生行为:窗口失焦(点了桌面其他地方)或按 Esc 时关闭菜单
  useEffect(() => {
    const un = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) closeMenu()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      void un.then((off) => off())
      window.removeEventListener('keydown', onKey)
    }
  }, [closeMenu])

  // M5 P5 时段彩蛋:每天(本地时区日历日)首次挂载时按本地时段冒一句问候
  useEffect(() => {
    const key = 'kimi.petGreetedDate'
    // sv  locale 输出 YYYY-MM-DD,按本地时区日历日(项目约定口径)
    const today = new Date().toLocaleDateString('sv')
    if (localStorage.getItem(key) === today) return
    localStorage.setItem(key, today)
    // 稍作延迟:避开窗口刚出现与其他开局气泡抢单槽
    const t = window.setTimeout(() => showBubble(greetingByHour(new Date().getHours())), 1500)
    return () => window.clearTimeout(t)
  }, [showBubble])

  // M4 拖拽方向:onMoved 在 OS 拖拽期间持续触发,比较相邻 dx;
  // startDragging 后 webview 不一定收得到 mouseup,停手检测用定时器兜底
  useEffect(() => {
    let disposed = false
    const un = getCurrentWindow().onMoved(({ payload }) => {
      if (disposed) return
      posX.current = payload.x
      const prev = lastPos.current
      lastPos.current = { x: payload.x, y: payload.y }
      if (!prev) return
      const dx = payload.x - prev.x
      if (Math.abs(dx) >= DRAG_DELTA) {
        setDragState(dx < 0 ? 'running-left' : 'running-right')
      }
      window.clearTimeout(dragEndTimer.current)
      dragEndTimer.current = window.setTimeout(() => {
        setDragState(null)
        lastPos.current = null
      }, DRAG_END_MS)
    })
    return () => {
      disposed = true
      void un.then((off) => off())
    }
  }, [])

  // M5 P5 闲置散步:idle/sleep 且无小跟班且开关打开时,每 30-60s 随机横挪 ±100~300px。
  // 移动期间复用 dragState 播 running-left/right(程序 set_position 也会触发 onMoved,
  // 这里手动设一份兜底);rustState 变化(来了事件)即触发本 effect 重建,停走并清定时器
  useEffect(() => {
    if (!wander || minionCount > 0) return
    if (rustState !== 'idle' && rustState !== 'sleep') return
    let disposed = false
    let timer = 0
    let edgeTimer = 0
    const schedule = () => {
      timer = window.setTimeout(tick, WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS))
    }
    const tick = () => {
      if (disposed) return
      // 用户正按着宠物(点击/拖拽交互中)本轮不走,直接排下一轮
      if (pressStart.current) {
        schedule()
        return
      }
      const dx =
        wanderDir.current * (WANDER_MIN_PX + Math.random() * (WANDER_MAX_PX - WANDER_MIN_PX))
      const fromX = posX.current
      // 动则收菜单:散步挪窗前收起悬浮菜单(未开时 hide 幂等 no-op)
      void window.kimiApi.petMenuHide().catch(() => undefined)
      void window.kimiApi.petNudge(dx).catch(() => undefined)
      // 复用拖拽动画机制:按方向播 running-left/right,移动落稳后清除
      setDragState(dx < 0 ? 'running-left' : 'running-right')
      window.clearTimeout(dragEndTimer.current)
      dragEndTimer.current = window.setTimeout(() => setDragState(null), WANDER_ANIM_MS)
      // 撞边反向:落稳后实际位移(物理 px)不足请求的一半,视为已到屏幕边缘
      edgeTimer = window.setTimeout(() => {
        if (disposed || fromX == null || posX.current == null) return
        const moved = posX.current - fromX
        if (Math.abs(moved) < Math.abs(dx) * (window.devicePixelRatio || 1) * 0.5) {
          wanderDir.current = -wanderDir.current
        }
      }, WANDER_ANIM_MS + 200)
      schedule()
    }
    schedule()
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.clearTimeout(edgeTimer)
    }
  }, [wander, rustState, minionCount])

  // 逐帧动画:非 loop 状态定格末帧等状态源切换,不在本地自行回落(Rust 驱动的部分
  // 避免与状态机脱节;本地 oneshot 由 triggerOneshot 的定时器清除)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !meta) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const fw = meta.frameW
    const fh = meta.frameH
    // 当前状态缺失时按扩展行 → running → idle 回退;idle 也缺失(异常 pet.json)则不画
    const anim = resolveAnim(meta, displayed)
    if (!anim) return
    // waving 行通常声明为一次性(loop:false,定格末帧);但菜单开着时 waving 被钉住,
    // 定格住会很呆,此时强制循环。点击触发的一次性 waving 也只播 ~600ms 窗口,
    // 循环几圈后由 triggerOneshot 定时器清除,无副作用
    const loop = anim.loop || displayed === 'waving'
    const dpr = window.devicePixelRatio || 1
    canvas.width = fw * dpr
    canvas.height = fh * dpr

    const img = new Image()
    // 内置宠物走打包资源;外部宠物走自定义 pet 协议(Rust 侧按 slug 定位精灵图)。
    // crossOrigin=anonymous + 协议响应的 ACAO:* 配套:否则画布被跨源污染,
    // 下面 detectFrames 的 getImageData 会抛 SecurityError 导致整只宠物不显示
    img.crossOrigin = 'anonymous'
    img.src = meta.source === 'builtin' ? builtinSheetUrl(meta.slug) : `http://pet.localhost/${meta.slug}`
    let raf = 0
    let start = 0
    const draw = (ts: number, frames: number) => {
      if (!start) start = ts
      const elapsed = (ts - start) / 1000
      let idx = Math.floor(elapsed * anim.fps)
      if (idx >= frames) {
        if (loop) {
          idx %= frames
        } else {
          // 一次性动作:定格末帧,停止循环(等状态源切换)
          idx = frames - 1
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, fw, fh)
      ctx.drawImage(img, idx * fw, anim.row * fh, fw, fh, 0, 0, fw, fh)
      if (loop || idx < frames - 1) raf = requestAnimationFrame((t) => draw(t, frames))
    }
    img.onload = () => {
      const frames = detectFrames(img, fw, fh, anim)
      raf = requestAnimationFrame((t) => draw(t, frames))
    }
    return () => cancelAnimationFrame(raf)
  }, [displayed, meta])

  return (
    <div
      className="relative flex h-full w-full items-end justify-center"
      // 点击/拖拽判别(M4):mousedown 只记录起点;移动超 CLICK_DIST 才 startDragging
      // (mousedown 立即拖的话,OS 接管后 webview 收不到 mouseup,点击永远判不出来);
      // 原位快速松开判定为点击(M5 P1):单击切换悬浮菜单,
      // 300ms 内第二次点击判双击:再 toggle 收起菜单后唤回主窗;
      // 右键弹自绘菜单(换宠物/点击穿透/隐藏桌宠,见 onContextMenu)
      onMouseDown={(e) => {
        if (e.button !== 0) return
        pressStart.current = { x: e.screenX, y: e.screenY, t: Date.now(), dragging: false }
      }}
      onMouseMove={(e) => {
        const p = pressStart.current
        if (!p || p.dragging) return
        if (Math.hypot(e.screenX - p.x, e.screenY - p.y) >= CLICK_DIST) {
          p.dragging = true
          // 动则收菜单:首次判定为拖拽的这一刻收起悬浮菜单(幂等 no-op)
          void window.kimiApi.petMenuHide().catch(() => undefined)
          void getCurrentWindow().startDragging()
        }
      }}
      onMouseUp={(e) => {
        if (e.button !== 0) return
        const p = pressStart.current
        pressStart.current = null
        if (!p || p.dragging) return
        if (Date.now() - p.t < CLICK_MS) {
          const now = Date.now()
          if (now - lastClickAt.current < DBLCLICK_MS) {
            // 双击(M5 P1):单击那次已开菜单,再 toggle 一次收起,然后唤回主窗
            lastClickAt.current = 0
            void window.kimiApi.petMenuToggle().catch(() => undefined)
            void window.kimiApi.petRestoreMain().catch(() => undefined)
          } else {
            // 单击:切换悬浮菜单(M5 P3;catch 兜底防后端异常打断交互)。
            // 菜单打开后 menuVisible 会把 displayed 钉在 waving,无需再触发一次性动作
            lastClickAt.current = now
            void window.kimiApi.petMenuToggle().catch(() => undefined)
          }
        }
      }}
      onContextMenu={(e) => {
        // 右键:屏蔽系统菜单,弹自绘菜单(换宠物/点击穿透/隐藏桌宠);重开时先清落位防闪
        e.preventDefault()
        setMenuPos(null)
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* 右键菜单(M5 自绘,样式对齐壳内白底蓝调):遮罩负责点外关闭,菜单本体收边在窗口内 */}
      {menuAt && (
        <div
          className="absolute inset-0 z-10"
          onMouseDown={(e) => {
            e.stopPropagation()
            closeMenu()
          }}
          onContextMenu={(e) => {
            // 遮罩上再右键 = 换个位置重开菜单
            e.preventDefault()
            e.stopPropagation()
            setMenuPos(null)
            setMenuAt({ x: e.clientX, y: e.clientY })
          }}
        />
      )}
      {menuAt && (
        <div
          ref={menuRef}
          className="absolute z-20 w-44 rounded-xl border border-border bg-white/95 p-1 shadow-lg backdrop-blur-sm"
          style={
            menuPos
              ? { left: menuPos.x, top: menuPos.y }
              : { left: menuAt.x, top: menuAt.y, visibility: 'hidden' }
          }
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-text-primary hover:bg-primary/10"
            onMouseEnter={openSub}
            onMouseLeave={closeSubSoon}
            onClick={openSub}
          >
            <PawPrint size={13} className="shrink-0 text-text-tertiary" />
            <span className="flex-1">换宠物</span>
            <ChevronRight size={13} className="shrink-0 text-text-tertiary" />
          </button>
          <div className="mx-1 my-1 h-px bg-border-light" />
          <button
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-text-primary hover:bg-primary/10"
            onMouseEnter={closeSubNow}
            onClick={() => {
              closeMenu()
              if (petCfg) void window.kimiApi.petSetClickThrough(!petCfg.clickThrough).catch(() => {})
            }}
          >
            <MousePointerClick size={13} className="shrink-0 text-text-tertiary" />
            <span className="flex-1">点击穿透</span>
            {petCfg?.clickThrough && (
              <span className="rounded bg-primary/10 px-1 py-px text-[10.5px] text-primary">已开启</span>
            )}
          </button>
          <button
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-text-primary hover:bg-primary/10"
            onMouseEnter={closeSubNow}
            onClick={() => {
              closeMenu()
              void window.kimiApi.petSetEnabled(false).catch(() => {})
            }}
          >
            <EyeOff size={13} className="shrink-0 text-text-tertiary" />
            <span>隐藏桌宠</span>
          </button>
        </div>
      )}
      {/* 换宠物子菜单:悬停浮出在主菜单左侧。窗口只有 240 宽,两栏并排必然重叠,
          靠 z-30 盖住主菜单;移回主菜单其他项(closeSubNow)或点外即收起 */}
      {menuAt && menuPos && subOpen && (
        <div
          className="absolute z-30 w-36 rounded-xl border border-border bg-white/95 p-1 shadow-lg backdrop-blur-sm"
          style={{
            left: Math.max(4, menuPos.x - 144 - 4),
            top: Math.max(4, Math.min(menuPos.y, window.innerHeight - 168))
          }}
          onMouseEnter={openSub}
          onMouseLeave={closeSubSoon}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="max-h-40 overflow-y-auto">
            {petOptions.map((p) => {
              const active = p.slug === (petCfg?.slug ?? meta?.slug)
              return (
                <button
                  key={p.slug}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-primary/10 ${
                    active ? 'font-medium text-primary' : 'text-text-primary'
                  }`}
                  onClick={() => {
                    closeMenu()
                    if (!active) void window.kimiApi.petSetActive(p.slug).catch(() => {})
                  }}
                >
                  <span className="w-3.5 shrink-0">{active && <Check size={13} />}</span>
                  <span className="truncate">{p.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {/* 台词气泡(M6 归位):贴角色视觉头顶(sprite 底边贴窗底、高 frameH,
          窗口顶部 250-frameH 的空间刚好放单行气泡+三角);限宽截断防长文案
          (审批命令)撑破窗口,warn 档(配额告警)暖色、三角同步变色。
          居中定位放外层(内联 transform 不与入场动画 keyframes 冲突) */}
      {bubble && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ bottom: (meta?.frameH ?? 208) + 4 }}
        >
          <div className="pet-bubble-in flex flex-col items-center">
            <div
              title={bubble.text}
              className={`max-w-[220px] truncate whitespace-nowrap rounded-xl border px-2 py-1 text-[12px] shadow ${
                bubble.tone === 'warn'
                  ? 'border-warning bg-warning-soft text-warning'
                  : 'border-border bg-white/95 text-text-secondary'
              }`}
            >
              {bubble.text}
            </div>
            {/* 下指小三角:旋转正方形,-mt-1 半叠在气泡底边上,颜色与气泡体一致 */}
            <div
              className={`-mt-1 h-2 w-2 rotate-45 border-b border-r ${
                bubble.tone === 'warn'
                  ? 'border-warning bg-warning-soft'
                  : 'border-border bg-white/95'
              }`}
            />
          </div>
        </div>
      )}
      {meta && (
        <div className="relative">
          {/* M5 P4 子代理小跟班:纯 overlay(不进 displayed 优先级链),主宠两侧
              脚边各一列(第 0/2 只左、第 1 只右),最多 3 只;pointer-events-none
              保证点击/拖拽仍落在外层容器;count>3 时第三只(左列第二只)旁挂 +N 角标 */}
          {minionCount > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between">
              <div className="flex items-end -space-x-8">
                {[0, 2]
                  .filter((i) => i < Math.min(minionCount, 3))
                  .map((i) => (
                    <div key={i} className="relative">
                      <MinionSprite meta={meta} index={i} />
                      {i === 2 && minionCount > 3 && (
                        <span className="absolute -right-1 top-0 rounded-full border border-border bg-white/95 px-1 text-[10px] leading-4 text-text-secondary shadow">
                          +{minionCount - 3}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
              <div className="flex flex-row-reverse items-end -space-x-8 -space-x-reverse">
                {minionCount > 1 && <MinionSprite meta={meta} index={1} />}
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ width: meta.frameW, height: meta.frameH }} />
        </div>
      )}
    </div>
  )
}
