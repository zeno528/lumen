import { api } from './client'

/** 抓取 URL 标题/描述（后端 utils.go:63 handleFetchTitle）*/
export function fetchPageTitle(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; description: string }> {
  return api(`/fetch-title?url=${encodeURIComponent(url)}`, { signal })
}

/** AI 元数据填充（后端 ai.go:20 handleAIMeta，POST {url, categories}）
 *  categories 传已有分类名，后端 prompt 提示 AI 排除重名
 *  响应对齐后端实际返回：title_cn/description_cn（AI 翻译中文）+ title/description（本地原始提取）
 *  + tags（逗号分隔字符串）+ usedSerper（"true"/"false"）*/
export function fetchAIMeta(
  url: string,
  categories: string[] = [],
  signal?: AbortSignal,
  previous?: { title: string; description: string; tags: string },
): Promise<{
  title_cn: string
  description_cn: string
  title: string
  description: string
  tags: string
  category: string
  usedSerper: string
}> {
  return api('/ai-meta', {
    method: 'POST',
    body: JSON.stringify({ url, categories, previous }),
    signal,
  })
}
