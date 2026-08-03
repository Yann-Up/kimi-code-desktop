import { useState } from 'react'
import { ChevronLeft, ChevronRight, HelpCircle, X } from 'lucide-react'
import { useStream, type PendingQuestion } from '../../stores/stream'

export function QuestionCard({ question }: { question: PendingQuestion }) {
  const { answerQuestion, dismissQuestion } = useStream()
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)

  if (done) return null

  const total = question.questions.length
  const current = Math.min(step, total - 1)
  const q = question.questions[current]
  const isLast = current === total - 1

  const toggle = (qid: string, oid: string, multi: boolean) => {
    setSelected((s) => {
      const cur = s[qid] ?? []
      if (multi) {
        return { ...s, [qid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] }
      }
      return { ...s, [qid]: [oid] }
    })
  }

  const answered = (qid: string) =>
    (selected[qid]?.length ?? 0) > 0 || (other[qid]?.trim().length ?? 0) > 0

  const submit = () => {
    const answers: Record<string, unknown> = {}
    for (const q of question.questions) {
      const sel = selected[q.id] ?? []
      const otherText = other[q.id]?.trim()
      if (otherText && sel.length === 0) {
        answers[q.id] = { kind: 'other', text: otherText }
      } else if (q.multi_select) {
        answers[q.id] = otherText
          ? { kind: 'multi_with_other', option_ids: sel, other_text: otherText }
          : { kind: 'multi', option_ids: sel }
      } else if (sel.length > 0) {
        answers[q.id] = { kind: 'single', option_id: sel[0] }
      }
    }
    setFailed(false)
    // 成功才隐藏卡片;失败保留卡片并提示重试(否则 refreshPending 拉回后 done 仍为 true 会永久消失)
    void answerQuestion(question.id, answers).then((ok) => {
      if (ok) setDone(true)
      else setFailed(true)
    })
  }

  const canSubmit = question.questions.every((q) => answered(q.id))
  const canNext = answered(q.id)

  return (
    <div className="rounded-xl border border-primary-border bg-primary-soft/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HelpCircle size={16} className="text-primary" />
          <span className="text-[13.5px] font-semibold">Kimi 想问你几个问题</span>
          {total > 1 && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
              {current + 1} / {total}
            </span>
          )}
        </div>
        <button
          className="rounded p-1 text-text-tertiary hover:bg-white/60"
          title="忽略"
          onClick={() => {
            setFailed(false)
            void dismissQuestion(question.id).then((ok) => {
              if (ok) setDone(true)
              else setFailed(true)
            })
          }}
        >
          <X size={14} />
        </button>
      </div>
      {total > 1 && (
        <div className="mb-3 flex gap-1">
          {question.questions.map((qq, i) => (
            <button
              key={qq.id}
              title={`第 ${i + 1} 题`}
              onClick={() => setStep(i)}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i === current ? 'bg-primary' : answered(qq.id) ? 'bg-primary/40' : 'bg-border'
              }`}
            />
          ))}
        </div>
      )}
      <div>
        <p className="mb-2 text-[13px] font-medium">
          {q.header && <span className="mr-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{q.header}</span>}
          {q.question}
        </p>
        <div className="space-y-1.5">
          {q.options.map((op) => {
            const active = (selected[q.id] ?? []).includes(op.id)
            return (
              <button
                key={op.id}
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                  active
                    ? 'border-primary bg-white text-primary'
                    : 'border-border bg-white/70 text-text-secondary hover:border-primary-border'
                }`}
                onClick={() => toggle(q.id, op.id, !!q.multi_select)}
              >
                <span
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-primary bg-primary' : 'border-text-tertiary'
                  }`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span>
                  {op.label}
                  {op.description && (
                    <span className="mt-0.5 block text-[12px] text-text-tertiary">
                      {op.description}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
          <input
            className="w-full rounded-lg border border-border bg-white/70 px-3 py-1.5 text-[13px] outline-none focus:border-primary-border"
            placeholder="其他(自定义回答)"
            value={other[q.id] ?? ''}
            onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button
          className="flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-[13px] text-text-secondary hover:bg-white/60 disabled:opacity-40"
          disabled={current === 0}
          onClick={() => setStep(current - 1)}
        >
          <ChevronLeft size={14} />
          上一题
        </button>
        {isLast ? (
          <button
            className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-40"
            disabled={!canSubmit}
            onClick={submit}
          >
            提交回答
          </button>
        ) : (
          <button
            className="flex items-center gap-0.5 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-40"
            disabled={!canNext}
            onClick={() => setStep(current + 1)}
          >
            下一题
            <ChevronRight size={14} />
          </button>
        )}
      </div>
      {failed && <p className="mt-2 text-[12px] text-danger">操作失败,请重试</p>}
    </div>
  )
}
