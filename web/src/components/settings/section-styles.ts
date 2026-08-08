/** 设置页 Section 卡片容器样式 -- 账号 / AI / Token 三个 tab 共用，单一来源（DRY）。
 *  调用方按需用 cn(SECTION_CLASS, 'gap-4') 覆盖 gap 等单项。 */
export const SECTION_CLASS =
  'flex flex-col gap-3 p-5 rounded-2xl border border-(--border) bg-(--bg-section) ring-1 ring-inset ring-white/8 section-card-shadow'