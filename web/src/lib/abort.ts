/**
 * 把外部 AbortSignal 与一个超时组合：任一触发即 abort。
 *
 * 用标准 AbortSignal.timeout + AbortSignal.any 替代手写 setTimeout / clearTimeout /
 * addEventListener 链——浏览器原生管理 timer，零样板、零泄漏风险。
 * 支持：Chrome 103+ / Firefox 100+ / Safari 15.4+（2022+ 全覆盖）。
 *
 * timeoutSignal 单独返回，用于调用方在 catch 里区分本次 abort 的原因：
 *   catch (e) {
 *     if (ts.timeoutSignal.aborted) ... // 是超时触发的（vs 外部 ESC / unmount）
 *     else if (ts.signal.aborted)   ... // 外部 cancel
 *   }
 */
export interface TimeoutSignalHandle {
  /** 传给 fetch / requestFn 的 signal */
  signal: AbortSignal
  /** 单独引用，检查是否由本次超时触发 */
  timeoutSignal: AbortSignal
}

export function createTimeoutSignal(
  external: AbortSignal | undefined,
  ms: number,
): TimeoutSignalHandle {
  const timeoutSignal = AbortSignal.timeout(ms)
  const signal = external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal
  return { signal, timeoutSignal }
}