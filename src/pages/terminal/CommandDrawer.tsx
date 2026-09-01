/**
 * 指令参考抽屉(终端视图右侧,推开式):新手向 TUI 斜杠命令与快捷键速查,
 * 减少查官方文档。内容按 CLI 0.39 官方文档精选静态内置(全量以 TUI 内 /help 为准);
 * 命令条目点击插入当前活动终端(不带回车,可编辑后自行提交);快捷键仅展示。
 */
import { PanelRightClose } from 'lucide-react'
import { useT } from '../../i18n'

interface CmdItem {
  /** 展示名(命令/键名原文,不译) */
  cmd: string
  /** 说明词条 key */
  descKey: string
  /** 点击插入到终端的文本;缺省=不可插入(快捷键) */
  insert?: string
}

const COMMON: CmdItem[] = [
  { cmd: '/help', descKey: 'terminal.cmd.help', insert: '/help' },
  { cmd: '/model', descKey: 'terminal.cmd.model', insert: '/model' },
  { cmd: '/new', descKey: 'terminal.cmd.new', insert: '/new' },
  { cmd: '/sessions', descKey: 'terminal.cmd.sessions', insert: '/sessions' },
  { cmd: '/compact', descKey: 'terminal.cmd.compact', insert: '/compact' },
  { cmd: '/web', descKey: 'terminal.cmd.web', insert: '/web' },
  { cmd: '/usage', descKey: 'terminal.cmd.usage', insert: '/usage' },
  { cmd: '/exit', descKey: 'terminal.cmd.exit', insert: '/exit' }
]

const MODES: CmdItem[] = [
  { cmd: '/plan', descKey: 'terminal.cmd.plan', insert: '/plan' },
  { cmd: '/yolo', descKey: 'terminal.cmd.yolo', insert: '/yolo' },
  { cmd: '/undo', descKey: 'terminal.cmd.undo', insert: '/undo' },
  { cmd: '/editor', descKey: 'terminal.cmd.editor', insert: '/editor' },
  { cmd: '/theme', descKey: 'terminal.cmd.theme', insert: '/theme' },
  { cmd: '!', descKey: 'terminal.cmd.bang', insert: '!' }
]

/** Tower 模式(实验性,KIMI_CODE_EXPERIMENTAL_TOWER 默认关;子命令定义见 CLI dist TOWER_ARG_COMPLETIONS) */
const TOWER: CmdItem[] = [
  { cmd: '/tower on', descKey: 'terminal.cmd.towerOn', insert: '/tower on' },
  { cmd: '/tower off', descKey: 'terminal.cmd.towerOff', insert: '/tower off' },
  { cmd: '/tower status', descKey: 'terminal.cmd.towerStatus', insert: '/tower status' },
  { cmd: '/tower teardown', descKey: 'terminal.cmd.towerTeardown', insert: '/tower teardown' }
]

const KEYS: CmdItem[] = [
  { cmd: 'Enter / Shift+Enter', descKey: 'terminal.key.enter' },
  { cmd: 'Esc / Ctrl+C', descKey: 'terminal.key.esc' },
  { cmd: '↑ / ↓', descKey: 'terminal.key.history' },
  { cmd: 'Shift+Tab', descKey: 'terminal.key.plan' },
  { cmd: 'Ctrl+S', descKey: 'terminal.key.steer' },
  { cmd: 'Ctrl+O', descKey: 'terminal.key.output' },
  { cmd: 'Ctrl+G', descKey: 'terminal.key.editor' },
  { cmd: 'Alt+V', descKey: 'terminal.key.pasteImage' }
]

function Group({
  title,
  items,
  noteKey,
  onInsert
}: {
  title: string
  items: CmdItem[]
  /** 组尾说明(词条 key;实验性分组的启用前提提示用) */
  noteKey?: string
  onInsert?: (text: string) => void
}) {
  const t = useT()
  return (
    <div>
      <p className="px-4 pb-1 pt-4 text-[11px] font-medium text-text-tertiary">{title}</p>
      {items.map((it) => {
        const clickable = it.insert !== undefined && onInsert !== undefined
        const row = (
          <>
            <span className="shrink-0 font-mono text-[12px] text-primary">{it.cmd}</span>
            <span className="min-w-0 flex-1 text-[12px] text-text-secondary">
              {t(it.descKey)}
            </span>
          </>
        )
        return clickable ? (
          <button
            key={it.cmd}
            className="flex w-full items-baseline gap-2.5 rounded-md px-4 py-1.5 text-left transition-colors hover:bg-surface-tertiary"
            title={t('terminal.insertHint')}
            onClick={() => onInsert(it.insert!)}
          >
            {row}
          </button>
        ) : (
          <div key={it.cmd} className="flex items-baseline gap-2.5 px-4 py-1.5">
            {row}
          </div>
        )
      })}
      {noteKey && (
        <p className="px-4 pt-1 text-[11px] leading-relaxed text-text-tertiary">{t(noteKey)}</p>
      )}
    </div>
  )
}

export function CommandDrawer({
  onInsert,
  onClose
}: {
  onInsert: (text: string) => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-4">
        <span className="text-[12px] font-medium">{t('terminal.cheatsheet')}</span>
        <span className="ml-2 text-[11px] text-text-tertiary">/help</span>
        <button
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:bg-surface-tertiary hover:text-text"
          onClick={onClose}
          title={t('terminal.close')}
        >
          <PanelRightClose size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <Group title={t('terminal.groupCommon')} items={COMMON} onInsert={onInsert} />
        <Group title={t('terminal.groupModes')} items={MODES} onInsert={onInsert} />
        <Group
          title={t('terminal.groupTower')}
          items={TOWER}
          noteKey="terminal.cmd.towerFlag"
          onInsert={onInsert}
        />
        <Group title={t('terminal.groupKeys')} items={KEYS} />
        <p className="px-4 pt-4 text-[11px] leading-relaxed text-text-tertiary">
          {t('terminal.cheatsheetNote')}
        </p>
      </div>
    </div>
  )
}
