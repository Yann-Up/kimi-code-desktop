import { memo, type AnchorHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'

/**
 * 链接渲染:阻止 webview 内默认导航(否则会带着全部 Tauri 权限跳到外部站点),
 * http(s) 链接经 openExternal 在系统浏览器打开,其它协议不响应点击并给出样式提示
 */
function MdLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const external = !!href && /^https?:\/\//i.test(href)
  return (
    <a
      href={href}
      rel="noreferrer"
      title={external ? href : '仅支持打开 http(s) 链接'}
      className={
        external
          ? 'cursor-pointer text-primary hover:underline'
          : 'cursor-not-allowed text-text-tertiary no-underline'
      }
      onClick={(e) => {
        e.preventDefault()
        if (external && href) void window.kimiApi.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ a: MdLink }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
