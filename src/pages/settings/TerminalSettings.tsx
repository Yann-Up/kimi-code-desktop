/**
 * 设置 · 终端:内嵌终端(TUI)的壳设置。
 * 均为前端偏好(localStorage,经 stores/ui 读写):默认工作目录(仅影响新窗格)与终端字号。
 */
import { Section, Card } from '../../components/settings/common'
import { Input } from '../../components/ui/Input'
import { Segmented } from '../../components/ui/Segmented'
import { useUi } from '../../stores/ui'
import { useT } from '../../i18n'

const FONT_SIZES = ['12', '13', '14', '16']

export function TerminalSettings() {
  const t = useT()
  const terminalCwd = useUi((s) => s.terminalCwd)
  const setTerminalCwd = useUi((s) => s.setTerminalCwd)
  const terminalFontSize = useUi((s) => s.terminalFontSize)
  const setTerminalFontSize = useUi((s) => s.setTerminalFontSize)

  return (
    <Section title={t('settings.terminal.title')} desc={t('settings.terminal.desc')}>
      <Card>
        {/* 默认工作目录:新窗格的启动目录,留空 = 用户主目录 */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-[475]">{t('settings.terminal.cwd')}</p>
            <p className="text-[12px] text-text-tertiary">{t('settings.terminal.cwdDesc')}</p>
          </div>
          <Input
            size="sm"
            className="w-56 shrink-0 font-mono"
            value={terminalCwd}
            placeholder={t('settings.terminal.cwdPlaceholder')}
            onChange={(e) => setTerminalCwd(e.target.value)}
          />
        </div>
        {/* 终端字号:所有窗格即时生效 */}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-0">
            <p className="text-[13px] font-[475]">{t('settings.terminal.fontSize')}</p>
            <p className="text-[12px] text-text-tertiary">
              {t('settings.terminal.fontSizeDesc')}
            </p>
          </div>
          <Segmented
            value={String(terminalFontSize)}
            options={FONT_SIZES.map((s) => ({ value: s, label: s }))}
            onChange={(v) => setTerminalFontSize(Number(v))}
          />
        </div>
      </Card>
    </Section>
  )
}
