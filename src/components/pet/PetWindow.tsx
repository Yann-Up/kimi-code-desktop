/**
 * PetWindow: 桌宠悬浮窗的渲染入口(?window=pet)。
 * canvas 逐帧绘制 spritesheet;状态行序与 petdex 约定一致(见 docs/desktop-pet-design.md)。
 * M3:动画元数据经 petActiveGet() 动态加载;内置宠物用打包 import 图,外部宠物走 http://pet.localhost/<slug>。
 * M4 显示优先级:dragState(拖拽方向)> oneshot(点击 waving / pet:tool 脉冲)> rustState(状态机)。
 * 前两层是本地状态,不进 Rust;气泡为纯前端文本层,与动画解耦。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { PetMeta, PetState } from '@/platform/kimi-api'
import spritesheetUrl from '@/assets/pets/kimi/spritesheet.png'

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
/** 状态跃迁气泡(rustState 变化时;idle/running/review 不打岔) */
const STATE_BUBBLE: Partial<Record<PetState, string[]>> = {
  jumping: ['搞定!', '收工收工!', '漂亮,又完成一个!'],
  failed: ['啊这…翻车了', '出错了,快看看我', '尴尬了…'],
  waiting: ['等你拍板呢', '审批一下嘛', '戳我没用,去点确认呀']
}
/** 点击宠物时的随机回应 */
const GREETINGS = [
  '你好呀',
  '我在我在',
  '别戳啦,痒',
  '戳我干嘛,活干完了吗',
  '再戳我可要收费了',
  '今天也要加油鸭'
]

/** 拖拽方向判定的最小位移(px);停手多久算拖拽结束(ms) */
const DRAG_DELTA = 4
const DRAG_END_MS = 300
/** 点击判定:位移 < 5px 且按下时长 < 300ms */
const CLICK_DIST = 5
const CLICK_MS = 300
/** 气泡停留时长 */
const BUBBLE_MS = 4000

/** 状态行解析:精确匹配 → running(方向/工具扩展行的兜底)→ idle */
function resolveAnim(meta: PetMeta, state: string) {
  const exact = meta.states[state]
  if (exact) return exact
  if (state.startsWith('tool:') || state === 'running-left' || state === 'running-right') {
    return meta.states['running'] ?? meta.states['idle']
  }
  return meta.states['idle']
}

/** 候选文案随机取一 */
function pick(texts: string[]): string {
  return texts[Math.floor(Math.random() * texts.length)]
}

export function PetWindow() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rustState, setRustState] = useState<PetState>('idle')
  // 拖拽方向(M4):onMoved 期间按 dx 符号给出,停手 DRAG_END_MS 后清除
  const [dragState, setDragState] = useState<PetState | null>(null)
  // 本地一次性动作(M4):'waving'(点击)或 `tool:<kind>`(工具脉冲),播完自动清
  const [oneshot, setOneshot] = useState<string | null>(null)
  // 台词气泡(null 不显示)
  const [bubble, setBubble] = useState<string | null>(null)
  // 当前激活宠物的元信息;未加载到时渲染空容器(不报错、不画图)
  const [meta, setMeta] = useState<PetMeta | null>(null)

  const metaRef = useRef<PetMeta | null>(null)
  metaRef.current = meta
  const oneshotTimer = useRef(0)
  const bubbleTimer = useRef(0)
  const dragEndTimer = useRef(0)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const pressStart = useRef<{ x: number; y: number; t: number; dragging: boolean } | null>(null)

  const displayed: string = dragState ?? oneshot ?? rustState

  const showBubble = useCallback((text: string) => {
    setBubble(text)
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

  // Rust 状态机 emit pet:state;跃迁到 jumping/failed/waiting 时带一句气泡
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

  // M3:加载激活宠物元信息;设置页切换宠物(petSetActive 发 pet:config-changed)后重载
  useEffect(() => {
    const reload = () => {
      window.kimiApi
        .petActiveGet()
        .then(setMeta)
        .catch(() => {})
    }
    reload()
    return window.kimiApi.onPetConfigChanged(reload)
  }, [])

  // M4 拖拽方向:onMoved 在 OS 拖拽期间持续触发,比较相邻 dx;
  // startDragging 后 webview 不一定收得到 mouseup,停手检测用定时器兜底
  useEffect(() => {
    let disposed = false
    const un = getCurrentWindow().onMoved(({ payload }) => {
      if (disposed) return
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
    const dpr = window.devicePixelRatio || 1
    canvas.width = fw * dpr
    canvas.height = fh * dpr

    const img = new Image()
    // 内置宠物走打包资源;外部宠物走自定义 pet 协议(Rust 侧按 slug 定位精灵图)。
    // crossOrigin=anonymous + 协议响应的 ACAO:* 配套:否则画布被跨源污染,
    // 下面 detectFrames 的 getImageData 会抛 SecurityError 导致整只宠物不显示
    img.crossOrigin = 'anonymous'
    img.src = meta.source === 'builtin' ? spritesheetUrl : `http://pet.localhost/${meta.slug}`
    let raf = 0
    let start = 0
    // 有效帧数探测:外部宠物某行的尾部帧可能是空格子(pet.json 未声明帧数时
    // 按行宽兜底),播到空帧会闪空。img 加载后逐格抽样 alpha,遇到首个空帧即截断
    const detectFrames = (): number => {
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
        // 探测失败(如画布仍被污染)按声明帧数播放,至少保证能显示
        return anim.frames
      }
    }
    const draw = (ts: number, frames: number) => {
      if (!start) start = ts
      const elapsed = (ts - start) / 1000
      let idx = Math.floor(elapsed * anim.fps)
      if (idx >= frames) {
        if (anim.loop) {
          idx %= frames
        } else {
          // 一次性动作:定格末帧,停止循环(等状态源切换)
          idx = frames - 1
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, fw, fh)
      ctx.drawImage(img, idx * fw, anim.row * fh, fw, fh, 0, 0, fw, fh)
      if (anim.loop || idx < frames - 1) raf = requestAnimationFrame((t) => draw(t, frames))
    }
    img.onload = () => {
      const frames = detectFrames()
      raf = requestAnimationFrame((t) => draw(t, frames))
    }
    return () => cancelAnimationFrame(raf)
  }, [displayed, meta])

  return (
    <div
      className="relative flex h-full w-full items-end justify-center"
      // 点击/拖拽判别(M4):mousedown 只记录起点;移动超 CLICK_DIST 才 startDragging
      // (mousedown 立即拖的话,OS 接管后 webview 收不到 mouseup,点击永远判不出来);
      // 原位快速松开判定为点击:waving + 随机回应。右键仅屏蔽系统菜单
      onMouseDown={(e) => {
        if (e.button !== 0) return
        pressStart.current = { x: e.screenX, y: e.screenY, t: Date.now(), dragging: false }
      }}
      onMouseMove={(e) => {
        const p = pressStart.current
        if (!p || p.dragging) return
        if (Math.hypot(e.screenX - p.x, e.screenY - p.y) >= CLICK_DIST) {
          p.dragging = true
          void getCurrentWindow().startDragging()
        }
      }}
      onMouseUp={(e) => {
        if (e.button !== 0) return
        const p = pressStart.current
        pressStart.current = null
        if (!p || p.dragging) return
        if (Date.now() - p.t < CLICK_MS) {
          triggerOneshot('waving', pick(GREETINGS))
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 台词气泡:宠物上方,短时停留自动消失 */}
      {bubble && (
        <div className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-white/95 px-2 py-1 text-[12px] text-text-secondary shadow">
          {bubble}
        </div>
      )}
      {meta && (
        <canvas ref={canvasRef} style={{ width: meta.frameW, height: meta.frameH }} />
      )}
    </div>
  )
}
