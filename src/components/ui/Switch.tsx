/**
 * Switch: 复刻官方 kimi web UI 的 .ui-switch(官方为 Vue 自研组件库,此处为 React 复刻)。
 * 36×20px,0.5px border-strong 边;关态底色 border-strong(灰),开态 accent 蓝;
 * thumb 16px 白圆(top/left 1.5px,开态 translateX 16px);禁用 opacity .5。
 */
export function Switch(props: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      title={props.title}
      className={`relative h-5 w-9 shrink-0 rounded-full border-[0.5px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        props.checked ? 'border-primary bg-primary' : 'border-border-strong bg-border-strong'
      }`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        className={`absolute left-[1.5px] top-[1.5px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          props.checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  )
}
