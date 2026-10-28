/**
 * dsh-file-link-menu —— 宿主半侧。
 *
 * 功能全部在浏览器半侧（./client）：文件链接的右键菜单由客户端插件挂到
 * `shell.overlay` 槽位，打开的宿主动作走 `session.openWorkspacePath`
 * Remote 方法。宿主条目只负责把包纳入 Loader 组合，因此这里没有副作用。
 */

/** Cordis 插件名（与 cordis.patch.yml 的 id 无关，供 Loader 诊断用）。 */
export const name = "file-link-menu";

/** 宿主侧不做任何事；保留 apply 让条目成为合法插件。 */
export function apply() {}
