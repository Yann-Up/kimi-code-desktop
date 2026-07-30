import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useStream, type PendingApproval } from '../../stores/stream'

export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const { answerApproval } = useStream()
  const [feedback, setFeedback] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)

  const answer = (decision: string, scope?: string, selectedLabel?: string) => {
    setFailed(false)
    // 成功才隐藏卡片;失败保留卡片并提示重试(否则 refreshPending 拉回后 done 仍为 true 会永久消失)
    void answerApproval(
      approval.id,
      decision,
      scope,
      rejecting ? feedback : undefined,
      selectedLabel
    ).then((ok) => {
      if (ok) setDone(true)
      else setFailed(true)
    })
  }

  if (done) return null

  return (
    <div className="rounded-xl border border-warning/40 bg-warning-soft p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldAlert size={16} className="text-warning" />
        <span className="text-[13.5px] font-semibold">需要审批:{approval.title}</span>
      </div>
      {approval.command && (
        <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2.5 text-[12px] text-text-secondary">
          {approval.command}
        </pre>
      )}
      {approval.options && approval.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {approval.options.map((op, i) => (
            <button
              key={op.id}
              title={op.description}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium ${
                i === 0
                  ? 'bg-primary text-white hover:bg-primary-hover'
                  : 'border border-border bg-white text-text-secondary hover:bg-surface-tertiary'
              }`}
              onClick={() =>
                // 选项应答(plan_review 等):decision 恒为 approved,所选经 selected_label 传达;
                // 按文案正则猜 approved/rejected 会把"自动接受"这类批准项映射成拒绝,语义反转
                answer('approved', undefined, op.label)
              }
            >
              {op.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {rejecting && (
            <input
              className="w-full rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] outline-none"
              placeholder="拒绝原因(可选)"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
              onClick={() => answer('approved')}
            >
              批准一次
            </button>
            <button
              className="rounded-lg border border-primary-border bg-white px-3.5 py-1.5 text-[13px] font-medium text-primary hover:bg-primary-soft"
              onClick={() => answer('approved', 'session')}
            >
              本次会话都允许
            </button>
            <button
              className="rounded-lg border border-border bg-white px-3.5 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-surface-tertiary"
              onClick={() => (rejecting ? answer('rejected') : setRejecting(true))}
            >
              拒绝
            </button>
          </div>
        </div>
      )}
      {failed && <p className="mt-2 text-[12px] text-danger">操作失败,请重试</p>}
    </div>
  )
}
