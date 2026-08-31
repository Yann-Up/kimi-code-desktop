// 键用点分命名(如 'nav.chat');zh/en 两语必须成对;插值用 {name} 占位
// 统计页:子页签(StatsPage)与 API 调用明细(ApiCallsTable)
export default {
  zh: {
    // 子页签
    'stats.tab.overview': '用量概览',
    'stats.tab.calls': 'API 调用',
    // API 调用明细:区块标题与操作
    'stats.calls.title': 'API 调用',
    'stats.calls.desc': '逐次 LLM 调用的 tokens、TTFT 与输出速度(step.end 口径,含主代理与子代理)',
    'stats.calls.refresh': '刷新',
    'stats.calls.loadFailed': '读取 API 调用数据失败',
    'stats.calls.empty': '暂无 API 调用记录',
    // 统计卡
    'stats.calls.cardCalls': 'API 调用次数',
    'stats.calls.cardOutputTokens': '输出 Tokens',
    'stats.calls.cardAvgTtft': '平均 TTFT',
    'stats.calls.cardAvgTps': '平均输出 TPS',
    'stats.calls.subAllSessions': '全部会话合计',
    'stats.calls.subTtft': '首 token 延迟',
    'stats.calls.subTpsExcl': '不含首 token 时间',
    'stats.calls.subTpsIncl': '含首 token 时间',
    // 表头
    'stats.calls.colTime': '时间',
    'stats.calls.colModel': '模型',
    'stats.calls.colSession': '会话',
    'stats.calls.colInput': '输入',
    'stats.calls.colCacheRead': '缓存命中',
    'stats.calls.colCacheCreate': '缓存创建',
    'stats.calls.colOutput': '输出',
    'stats.calls.colTtft': 'TTFT',
    'stats.calls.colTpsExcl': 'TPS(不含首token)',
    'stats.calls.colTpsIncl': 'TPS(含首token)',
    // 分页
    'stats.calls.pageInfo': '共 {total} 条 · 第 {page} / {totalPages} 页',
    'stats.calls.perPage': '{n} 条/页',
    'stats.calls.prevPage': '上一页',
    'stats.calls.nextPage': '下一页'
  } as Record<string, string>,
  en: {
    'stats.tab.overview': 'Usage Overview',
    'stats.tab.calls': 'API Calls',
    'stats.calls.title': 'API Calls',
    'stats.calls.desc':
      'Per-call tokens, TTFT, and output speed for each LLM call (step.end basis, including the main agent and subagents)',
    'stats.calls.refresh': 'Refresh',
    'stats.calls.loadFailed': 'Failed to load API call data',
    'stats.calls.empty': 'No API call records yet',
    'stats.calls.cardCalls': 'API Calls',
    'stats.calls.cardOutputTokens': 'Output Tokens',
    'stats.calls.cardAvgTtft': 'Avg TTFT',
    'stats.calls.cardAvgTps': 'Avg Output TPS',
    'stats.calls.subAllSessions': 'Total across all sessions',
    'stats.calls.subTtft': 'Time to first token',
    'stats.calls.subTpsExcl': 'Excluding first-token time',
    'stats.calls.subTpsIncl': 'Including first-token time',
    'stats.calls.colTime': 'Time',
    'stats.calls.colModel': 'Model',
    'stats.calls.colSession': 'Session',
    'stats.calls.colInput': 'Input',
    'stats.calls.colCacheRead': 'Cache Hit',
    'stats.calls.colCacheCreate': 'Cache Creation',
    'stats.calls.colOutput': 'Output',
    'stats.calls.colTtft': 'TTFT',
    'stats.calls.colTpsExcl': 'TPS (excl. first token)',
    'stats.calls.colTpsIncl': 'TPS (incl. first token)',
    'stats.calls.pageInfo': '{total} records · Page {page} / {totalPages}',
    'stats.calls.perPage': '{n}/page',
    'stats.calls.prevPage': 'Previous page',
    'stats.calls.nextPage': 'Next page'
  } as Record<string, string>
}
