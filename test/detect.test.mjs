import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";

// ---------------------------------------------------------------- 极简 DOM
class Element {
	constructor(tag, attrs = {}, children = []) {
		this.tag = tag;
		this.attrs = attrs;
		this.children = children;
		this.parent = null;
		this.textContent = attrs.__text ?? "";
		for (const child of children) child.parent = this;
	}
	getAttribute(name) {
		return Object.prototype.hasOwnProperty.call(this.attrs, name) ? String(this.attrs[name]) : null;
	}
	hasAttribute(name) {
		return Object.prototype.hasOwnProperty.call(this.attrs, name);
	}
	querySelector(selector) {
		const match = (node) => {
			if (selector === "img" && node.tag === "img") return node;
			return null;
		};
		const walk = (node) => {
			for (const child of node.children) {
				const hit = match(child);
				if (hit !== null) return hit;
				const deep = walk(child);
				if (deep !== null) return deep;
			}
			return null;
		};
		return walk(this);
	}
	closest(selector) {
		let node = this;
		while (node !== null) {
			if (selector === "button" && node.tag === "button") return node;
			if (selector === "[data-changed-files]" && node.hasAttribute("data-changed-files")) return node;
			node = node.parent;
		}
		return null;
	}
}
class HTMLElement extends Element {}

const registry = new Map();
const document = {
	baseURI: "http://127.0.0.1:7027/",
	getElementById(id) {
		return registry.get(id) ?? null;
	}
};

// ------------------------------------------------------- 加载客户端插件工厂
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let captured = null;
const window = {
	__ModuleLoader__: {
		load(spec) {
			captured = spec;
		}
	}
};
const ReactStub = { createElement: () => null, Fragment: Symbol("Fragment"), useCallback: (fn) => fn, useEffect: () => undefined, useRef: () => ({ current: 0 }), useState: () => [null, () => undefined] };
const primitivesStub = {
	Menu: () => null,
	Toast: () => null,
	writeClipboard: async () => true,
	IconCopyOutlineRegular: () => null,
	IconFolderOpenRegular: () => null,
	IconRightUpOutlineRegular: () => null
};
function fakeRequire(spec) {
	if (spec === "react") return ReactStub;
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitivesStub;
	throw new Error("unexpected require: " + spec);
}
runInNewContext(source, { window, document, Element, HTMLElement, URL, console }, { filename: "client.js" });
assert.equal(captured.id, "dsh-file-link");
const exportsObject = captured.factory(fakeRequire);
const test = exportsObject.__test;
assert.ok(test, "exports.__test present");

const button = (attrs, children = []) => new HTMLElement("button", attrs, children);
const img = (src) => new HTMLElement("img", { src });

// ---------------------------------------------------------------- 测试用例
// 1. Markdown 文件链接（相对路径）
{
	const el = button({ class: "_fileMention_1ypvv_85 _fileLink_1ypvv_59", title: "docs/07-并发测试报告-2026-10-27.md" });
	assert.equal(test.detectFileTarget(el), "docs/07-并发测试报告-2026-10-27.md");
}
// 2. 行内产物引用
{
	const el = button({ class: "_fileMention_1ypvv_85", title: "tools/concurrency-test.js" });
	assert.equal(test.detectFileTarget(el), "tools/concurrency-test.js");
}
// 3. #L 行号锚点
{
	const el = button({ class: "_fileMention_1ypvv_85", title: "src/app.ts#L24-L30" });
	assert.equal(test.detectFileTarget(el), "src/app.ts");
}
// 4. 图片文件链接：路径在 ?path= 里
{
	const el = button({ class: "_fileMention_1ypvv_85 _fileLink_1ypvv_59" }, [img("/api/file?path=C%3A%5Cwork%5Cshot.png")]);
	assert.equal(test.detectFileTarget(el), "C:\\work\\shot.png");
}
// 5. 普通按钮 / 外链不受影响
{
	assert.equal(test.detectFileTarget(button({ class: "_button_abc" })), null);
	assert.equal(test.detectFileTarget(button({ class: "_fileMention_1ypvv_85", title: "查看报告" })), null);
}
// 6. @ 引用芯片不接管
{
	const el = button({ class: "_fileMention_1ypvv_85", title: "docs/a.md", "data-ref-chip": "" });
	assert.equal(test.detectFileTarget(el), null);
}
// 7. changed-files 卡片
{
	registry.set("path-0", new HTMLElement("span", { __text: "C:\\work\\src\\a.ts" }));
	const card = new HTMLElement("div", { "data-changed-files": "" });
	const row = new HTMLElement("button", { class: "hz8-rW_row", "aria-describedby": "path-0" }, []);
	row.parent = card;
	assert.equal(test.detectFileTarget(row), "C:\\work\\src\\a.ts");
	registry.clear();
}
// 8. 交付物卡片
{
	const el = button({ class: "nyYjTG_cardPreview", title: "D:\\dshquick\\out\\report.pdf" });
	assert.equal(test.detectFileTarget(el), "D:\\dshquick\\out\\report.pdf");
}
// 9. 路径拼接
{
	assert.equal(test.joinPath("D:\\dshquick", "docs/a.md"), "D:\\dshquick\\docs\\a.md");
	assert.equal(test.joinPath("D:\\dshquick\\", "docs/a.md"), "D:\\dshquick\\docs\\a.md");
	assert.equal(test.joinPath("D:\\dshquick", "tools\\a.js"), "D:\\dshquick\\tools\\a.js");
	assert.equal(test.joinPath("/home/u/proj", "docs/a.md"), "/home/u/proj/docs/a.md");
	assert.equal(test.joinPath(undefined, "docs/a.md"), "docs/a.md");
	assert.equal(test.joinPath("D:\\dshquick", "C:/x/y.md"), "C:\\x\\y.md");
}
// 10. 绝对路径识别
{
	assert.equal(test.isAbsolutePath("C:\\a"), true);
	assert.equal(test.isAbsolutePath("C:/a"), true);
	assert.equal(test.isAbsolutePath("\\\\server\\share"), true);
	assert.equal(test.isAbsolutePath("/opt/a"), true);
	assert.equal(test.isAbsolutePath("docs/a.md"), false);
}
console.log("ALL TESTS PASSED");
