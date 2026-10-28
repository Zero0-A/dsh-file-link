/**
 * dsh-file-link —— 浏览器半侧（Web 客户端插件）。
 *
 * 在聊天里右键 DSH 渲染出的文件链接，弹出与 DSH 同风格的菜单：
 *   打开文件 / 打开文件所在目录 / 复制文件地址
 *
 * 覆盖的链接形态：
 *   - Markdown 文件链接与行内产物引用按钮（class 含 fileMention / fileLink，title 即路径）；
 *   - 图片文件链接（没有 title，路径在预览图的 ?path= 参数里）；
 *   - "已编辑 N 个文件"卡片的文件行（绝对路径藏在 aria-describedby 指向的隐藏节点里）；
 *   - 交付物卡片（class 含 cardPreview，title 即绝对路径）。
 *
 * 打开动作走宿主 Remote：session.openWorkspacePath({path}) / ({path, action: "reveal"})，
 * 与 DSH 自带的"打开 / 显示文件位置"是同一套实现；复制地址走 primitives 的 writeClipboard。
 */
window.__ModuleLoader__.load({
	id: "dsh-file-link",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const {
			Menu,
			Toast,
			writeClipboard,
			IconCopyOutlineRegular,
			IconFolderOpenRegular,
			IconRightUpOutlineRegular
		} = primitives;
		const h = React.createElement;

		// ------------------------------------------------------------------
		// 文案
		// ------------------------------------------------------------------
		/** 本插件独占的 locale 命名空间。 */
		const NS = "file-link";
		/** 简体中文（键集的事实来源）。 */
		const zh = {
			"menu.open": "打开文件",
			"menu.reveal": "打开文件所在目录",
			"menu.copy": "复制文件地址",
			"toast.copied": "已复制文件地址",
			"toast.copyFailed": "复制文件地址失败",
			"toast.openFailed": "打开文件失败",
			"toast.revealFailed": "打开文件所在目录失败",
			"toast.noWorkspace": "无法定位文件所在目录"
		};
		/** English，与 zh 键集一致。 */
		const en = {
			"menu.open": "Open file",
			"menu.reveal": "Open containing folder",
			"menu.copy": "Copy file path",
			"toast.copied": "File path copied",
			"toast.copyFailed": "Could not copy the file path",
			"toast.openFailed": "Could not open the file",
			"toast.revealFailed": "Could not open the containing folder",
			"toast.noWorkspace": "Could not locate the containing folder"
		};

		/** 少量布局样式；菜单外观完全来自 primitives 的 Menu。 */
		const CSS = [
			".flm-icon{display:inline-flex;align-items:center;justify-content:center}",
			".flm-menu{min-width:188px}"
		].join("\n");

		// ------------------------------------------------------------------
		// 路径工具
		// ------------------------------------------------------------------
		/** 元素的 class 文本（SVG 的 className 不是字符串，这里统一走属性）。 */
		function classText(element) {
			const value = element.getAttribute("class");
			return value === null ? "" : value;
		}

		/** Windows 盘符 / UNC / POSIX 绝对路径。 */
		function isAbsolutePath(path) {
			return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\/.test(path) || path.startsWith("/");
		}

		/** Windows 路径统一用反斜杠，便于复制到资源管理器 / 其它程序直接使用。 */
		function normalizeWindowsSeparators(path) {
			return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") ? path.replace(/\//g, "\\") : path;
		}

		/** 把会话工作目录与相对路径拼成绝对路径（不解析 ..，宿主的 fs.resolve 会兜底）。 */
		function joinPath(cwd, path) {
			if (isAbsolutePath(path)) return normalizeWindowsSeparators(path);
			if (typeof cwd !== "string" || cwd === "") return path;
			const windows = /^[a-zA-Z]:[\\/]/.test(cwd) || cwd.includes("\\");
			if (!windows) return cwd.replace(/[\\/]+$/, "") + "/" + path.replace(/^[\\/]+/, "");
			const root = cwd.replace(/[\\/]+$/, "").replace(/\//g, "\\");
			const tail = path.replace(/^[\\/]+/, "").replace(/\//g, "\\");
			return root + "\\" + tail;
		}

		/** 去掉 Markdown 链接尾部的 #L24 / #L24-L30 行号锚点。 */
		function stripLineSuffix(path) {
			return path.replace(/#L\d+(?:-L?\d+)?$/i, "");
		}

		/** 粗判一个字符串是否像文件路径，避免把普通标签当路径。 */
		function looksLikePath(path) {
			return /[\\/]/.test(path) || /\.[A-Za-z0-9]{1,12}$/.test(path);
		}

		/** 图片文件链接：路径在预览图 src 的 ?path= 参数里（宿主返回的是绝对路径）。 */
		function imagePathOf(button) {
			const image = button.querySelector("img");
			if (image === null) return "";
			const src = image.getAttribute("src");
			if (src === null || src === "") return "";
			try {
				const url = new URL(src, document.baseURI);
				const path = url.searchParams.get("path");
				return typeof path === "string" ? path : "";
			} catch (error) {
				return "";
			}
		}

		/** changed-files 卡片：绝对路径在 aria-describedby 指向的隐藏节点里。 */
		function describedPathOf(button) {
			const reference = button.getAttribute("aria-describedby");
			if (reference === null || reference === "") return "";
			for (const id of reference.split(/\s+/)) {
				const holder = document.getElementById(id);
				if (holder === null) continue;
				const text = (holder.textContent || "").trim();
				if (text !== "" && isAbsolutePath(text)) return text;
			}
			return "";
		}

		/**
		 * 从右键落点还原被点的文件路径。
		 * @returns 文件路径（相对或绝对），不是文件链接时返回 null。
		 */
		function detectFileTarget(target) {
			if (!(target instanceof Element)) return null;
			const button = target.closest("button");
			if (!(button instanceof HTMLElement)) return null;
			// @ 引用输入框里的引用芯片不属于聊天内容，避免误伤。
			if (button.hasAttribute("data-ref-chip")) return null;
			const classes = classText(button);
			let path = "";
			if (/fileMention|fileLink/.test(classes)) {
				path = (button.getAttribute("title") || "").trim();
				if (path === "") path = imagePathOf(button);
			} else if (button.closest("[data-changed-files]") !== null) {
				path = describedPathOf(button);
			} else if (/cardPreview/.test(classes)) {
				path = (button.getAttribute("title") || "").trim();
			} else {
				return null;
			}
			path = stripLineSuffix(path);
			if (path === "" || !looksLikePath(path)) return null;
			return path;
		}

		/** 当前主视图里会话的工作目录（用于把相对路径补成绝对路径）。 */
		function currentWorkspaceCwd(ctx) {
			try {
				const state = ctx.sessions.list.getSnapshot();
				const rows = state && state.byId ? Object.values(state.byId) : [];
				if (rows.length === 0) return undefined;
				const visible = rows.filter((row) => row && ((row.retainedBy && row.retainedBy.mainView) || 0) > 0);
				const row = visible[0] || rows.find((candidate) => candidate && typeof candidate.cwd === "string" && candidate.cwd !== "");
				return row && typeof row.cwd === "string" ? row.cwd : undefined;
			} catch (error) {
				return undefined;
			}
		}

		// ------------------------------------------------------------------
		// 宿主动作
		// ------------------------------------------------------------------
		/** 把 Remote 的 {ok, value} / {ok, error} 结果收敛成 {ok, message}。 */
		function settle(result) {
			if (result && result.ok) return { ok: true, value: result.value };
			const error = result && result.error;
			const message = error && typeof error.message === "string" ? error.message : "";
			return { ok: false, message };
		}

		/** 组件可调用的菜单动作集合。 */
		function createMenuApi(ctx) {
			return {
				/** 右键落点 → {path, absolute, hasWorkspace}。 */
				detect(target) {
					const path = detectFileTarget(target);
					if (path === null) return null;
					const cwd = currentWorkspaceCwd(ctx);
					const absolute = joinPath(cwd, path);
					return { path, absolute, hasWorkspace: isAbsolutePath(absolute) };
				},
				/** 宿主桌面能否打开本地路径；查询失败时按可用处理，让动作自己报错。 */
				async canOpen() {
					try {
						const settled = settle(await ctx.remote.session.canOpenWorkspacePath());
						return settled.ok ? settled.value === true : true;
					} catch (error) {
						return true;
					}
				},
				/** 用系统默认程序打开文件。 */
				async open(absolute) {
					try {
						return settle(await ctx.remote.session.openWorkspacePath({ path: absolute }));
					} catch (error) {
						return { ok: false, message: error instanceof Error ? error.message : String(error) };
					}
				},
				/** 在系统文件管理器中定位文件。 */
				async reveal(absolute) {
					try {
						return settle(await ctx.remote.session.openWorkspacePath({ path: absolute, action: "reveal" }));
					} catch (error) {
						return { ok: false, message: error instanceof Error ? error.message : String(error) };
					}
				},
				/** 复制文件地址。 */
				async copy(text) {
					try {
						return (await writeClipboard(text)) === true;
					} catch (error) {
						return false;
					}
				}
			};
		}

		// ------------------------------------------------------------------
		// 菜单宿主组件
		// ------------------------------------------------------------------
		/** 挂在 shell.overlay 上的全局右键菜单宿主。 */
		function FileLinkMenuHost(props) {
			const menu = props.menu;
			const t = props.t;
			const [target, setTarget] = React.useState(null);
			const [nativeAvailable, setNativeAvailable] = React.useState(null);
			const [toast, setToast] = React.useState(null);
			const toastSeq = React.useRef(0);

			const showToast = React.useCallback((text, tone) => {
				toastSeq.current += 1;
				setToast({ id: toastSeq.current, text, tone });
			}, []);

			// 全局捕获 contextmenu：只有落点确实是文件链接时才接管。
			React.useEffect(() => {
				const onContextMenu = (event) => {
					if (event.defaultPrevented) return;
					const detected = menu.detect(event.target);
					if (detected === null) return;
					event.preventDefault();
					event.stopPropagation();
					setTarget({
						...detected,
						x: event.clientX,
						y: event.clientY
					});
				};
				document.addEventListener("contextmenu", onContextMenu, true);
				return () => {
					document.removeEventListener("contextmenu", onContextMenu, true);
				};
			}, [menu]);

			// 首次弹出时问一次宿主桌面是否可打开本地路径（页面生命周期内只问一次）。
			React.useEffect(() => {
				if (target === null || nativeAvailable !== null) return;
				let active = true;
				menu.canOpen().then((value) => {
					if (active) setNativeAvailable(value);
				}).catch(() => {
					if (active) setNativeAvailable(true);
				});
				return () => {
					active = false;
				};
			}, [target, nativeAvailable, menu]);

			const close = React.useCallback(() => {
				setTarget(null);
			}, []);

			const run = React.useCallback((id) => {
				const current = target;
				setTarget(null);
				if (current === null) return;
				if (id === "open" || id === "reveal") {
					if (!current.hasWorkspace) {
						showToast(t("toast.noWorkspace"));
						return;
					}
					const pending = id === "open" ? menu.open(current.absolute) : menu.reveal(current.absolute);
					pending.then((outcome) => {
						if (outcome.ok) return;
						const base = id === "open" ? t("toast.openFailed") : t("toast.revealFailed");
						showToast(outcome.message ? base + "：" + outcome.message : base);
					});
					return;
				}
				if (id === "copy") {
					menu.copy(current.absolute).then((ok) => {
						showToast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : undefined);
					});
				}
			}, [target, menu, t, showToast]);

			const anchorRect = React.useCallback(() => {
				if (target === null) return null;
				return {
					left: target.x,
					top: target.y,
					right: target.x,
					bottom: target.y,
					width: 0,
					height: 0,
					x: target.x,
					y: target.y
				};
			}, [target]);

			if (target === null) {
				return toast === null ? null : h(Toast, {
					key: toast.id,
					text: toast.text,
					tone: toast.tone,
					onDone: () => setToast(null)
				});
			}

			const items = [];
			if (nativeAvailable !== false) {
				items.push({ id: "open", label: t("menu.open"), icon: h(IconRightUpOutlineRegular, { className: "flm-icon" }) });
				items.push({ id: "reveal", label: t("menu.reveal"), icon: h(IconFolderOpenRegular, { className: "flm-icon" }) });
				items.push({ id: "separator", type: "separator" });
			}
			items.push({ id: "copy", label: t("menu.copy"), icon: h(IconCopyOutlineRegular, { className: "flm-icon" }) });

			return h(React.Fragment, null,
				h(Menu, {
					open: true,
					anchor: h("span", { "data-file-link": "", style: { display: "inline-block", width: 0, height: 0 } }),
					items,
					onSelect: run,
					onClose: close,
					portal: true,
					align: "start",
					side: "bottom",
					autoFocus: true,
					getAnchorRect: anchorRect,
					listClassName: "flm-menu"
				}),
				toast !== null && h(Toast, {
					key: toast.id,
					text: toast.text,
					tone: toast.tone,
					onDone: () => setToast(null)
				})
			);
		}

		// ------------------------------------------------------------------
		// 插件装配
		// ------------------------------------------------------------------
		/** 需要的客户端服务：槽位、文案、会话（取 cwd）、Remote（打开/定位）。 */
		const inject = ["slots", "locale", "sessions", "remote", "remote.session"];

		function apply(ctx) {
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-file-link";
				tag.textContent = CSS;
				document.head.append(tag);
				return () => {
					tag.remove();
				};
			}, "dsh-file-link: styles");

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-file-link: dictionaries");

			const t = ctx.locale.bind(NS);
			const menu = createMenuApi(ctx);
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "file-link.host",
				order: 60,
				locale: NS,
				inject: () => ({ menu, t })
			}, FileLinkMenuHost));
		}

		// 仅用于离线单元测试（浏览器里无副作用）。
		exports.__test = {
			detectFileTarget,
			currentWorkspaceCwd,
			isAbsolutePath,
			joinPath,
			looksLikePath,
			stripLineSuffix
		};

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
