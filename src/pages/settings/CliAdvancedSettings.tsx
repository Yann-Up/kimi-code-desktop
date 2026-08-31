/**
 * CLI 配置 · 高级:直接读写 <kimi 数据目录>/config.toml 源文件(经目标通道,本机/WSL/SSH 通用)。
 * 走本地 IPC,不依赖 kimi web 服务;写前自动备份为 .kimi-desktop-bak(原子写)。
 * 不做 TOML 校验——语法错误会由 CLI 在下次启动时报出,请谨慎编辑。
 */
import { useCallback, useEffect, useState } from 'react'
import { Edit3, RotateCw, Save, Undo2 } from 'lucide-react'
import { Card, GroupLabel, Section, Empty } from '../../components/settings/common'
import { useT } from '../../i18n'

export function CliAdvancedSettings() {
  const t = useT()
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const c = await window.kimiApi.cliConfigRead()
      setContent(c)
      setDraft(c ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const startEdit = () => {
    setDraft(content ?? '')
    setEditing(true)
    setMsg(null)
    setError('')
  }

  const cancelEdit = () => {
    setDraft(content ?? '')
    setEditing(false)
    setMsg(null)
    setError('')
  }

  const save = async () => {
    setSaving(true)
    setMsg(null)
    setError('')
    try {
      const backup = await window.kimiApi.cliConfigWrite(draft)
      setContent(draft)
      setEditing(false)
      setMsg({ ok: true, text: t('settings.cliAdvanced.savedOk', { backup }) })
    } catch (e) {
      setMsg({ ok: false, text: t('settings.cliAdvanced.saveFailed', { error: e instanceof Error ? e.message : String(e) }) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title={t('settings.cliAdvanced')}
      desc={t('settings.cliAdvanced.desc')}
      fill
    >
      <GroupLabel>{t('settings.cliAdvanced.groupSource')}</GroupLabel>
      <Card className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <Empty text={t('settings.cliAdvanced.loading')} />
        ) : error ? (
          <>
            <Empty text={t('settings.cliAdvanced.readFailed', { error })} />
            <div className="mt-2 flex justify-end">
              <button
                className="rounded-lg border border-border bg-elevated px-3.5 py-2 text-[13px] text-text hover:bg-hover"
                onClick={() => void load()}
              >
                {t('settings.cliAdvanced.retry')}
              </button>
            </div>
          </>
        ) : content === null && !editing ? (
          <>
            <Empty text={t('settings.cliAdvanced.notFound')} />
            <div className="mt-2 flex justify-end gap-2">
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
                onClick={startEdit}
              >
                <Edit3 size={13} /> {t('settings.cliAdvanced.createEdit')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* 工具栏:只读/编辑切换 + 重新载入 */}
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-[11.5px] text-text-tertiary">
                {content === null ? t('settings.cliAdvanced.fileMissing') : t('settings.cliAdvanced.bytes', { n: content.length })}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {editing ? (
                  <>
                    <button
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-text transition-colors hover:bg-fill"
                      disabled={saving}
                      onClick={cancelEdit}
                    >
                      <Undo2 size={12} /> {t('settings.cliAdvanced.cancel')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                      disabled={saving}
                      onClick={() => void save()}
                    >
                      <Save size={12} /> {saving ? t('settings.cliAdvanced.writing') : t('settings.cliAdvanced.save')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-text transition-colors hover:bg-fill"
                      onClick={() => void load()}
                    >
                      <RotateCw size={12} /> {t('settings.cliAdvanced.reload')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover"
                      onClick={startEdit}
                    >
                      <Edit3 size={12} /> {t('settings.cliAdvanced.edit')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {editing ? (
              <textarea
                className="min-h-40 w-full flex-1 resize-none rounded-lg border border-border bg-surface-secondary p-3 font-mono text-[12px] leading-relaxed outline-none transition-colors focus:border-primary"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              <pre className="min-h-40 w-full flex-1 overflow-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-[12px] leading-relaxed text-text whitespace-pre-wrap">
                {content ?? ''}
              </pre>
            )}

            {msg && (
              <p className={`mt-2 text-[12px] ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>
            )}
          </>
        )}
      </Card>

      <p className="mt-3 text-[11.5px] text-text-tertiary">
        {t('settings.cliAdvanced.footnote')}
      </p>
    </Section>
  )
}
