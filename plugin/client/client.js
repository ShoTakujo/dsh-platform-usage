/**
 * dsh-official-usage —— client 侧（设置页「平台用量」分区）
 *
 * 宿主校验要求（照 dsh-usage-heatmap 实测出来的坑）：
 *   ① 必须 export const inject = ['slots']
 *   ② slots.register 的 slot 名必须是字符串字面量，且 { 紧跟 register( 同一行
 *   ③ 组件必须是 React 组件，经 factory 注入的 require('react') 取 React
 *
 * 这一层做两件事：
 *   1. 把 iframe 指向 host 的同源路由 /dsh-official-usage/panel.html
 *      （面板自己取数、自己刷新 —— 刷新逻辑只有一份）
 *   2. 给设置页导航行换上 3×3 热力图图标（见 installSettingsNavIcon）
 */
window.__ModuleLoader__.load({
	id: 'dsh-official-usage',
	factory: (require) => {
		var React = require('react')
		var h = React.createElement

		var PLUGIN_ID = 'dsh-official-usage'
		var PANEL_URL = '/dsh-official-usage/panel.html'
		var SECTION_LABEL = '平台用量'

		/**
		 * 设置页导航图标：3×3 热力图格子。
		 *
		 * **为什么需要打补丁**（2026-09-25 查证，来自 dsh-usage-heatmap 的实测记录）：
		 *   ① 宿主 `ui-settings-general` 的 `navIcon(id)` 是按 id 硬编码的图标映射，
		 *      未知 id 一律回落成齿轮；
		 *   ② `settings.section` 槽位契约只有 id / order / label，**没有 icon 字段**；
		 *   ③ 借官方已发布的 id 会顶替掉官方分区，不可行。
		 * ⇒ 做法：给「我们这一行」打标记，CSS 藏掉外壳的齿轮、用 mask 画出本图标。
		 *   图标纯黑走 mask（只读 alpha），可见色由 background-color: currentColor 提供，
		 *   所以 hover / 选中 / 禁用都会自动跟随主题色。
		 *   宿主 DOM 变了补丁会**静默失效**，不影响面板本体。
		 */
		var NAV_ICON_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='%23000'%3E%3Crect x='2' y='2' width='3' height='3' rx='0.8' opacity='.25'/%3E%3Crect x='6' y='2' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='10' y='2' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='2' y='6' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='6' y='6' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='10' y='6' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='2' y='10' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='6' y='10' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='10' y='10' width='3' height='3' rx='0.8'/%3E%3C/g%3E%3C/svg%3E\")"
		var NAV_ICON_MARKER = 'data-dou-nav-icon'
		var NAV_ROW_SELECTOR = '[role="dialog"] nav button'

		function navIconCss() {
			return [
				'[' + NAV_ICON_MARKER + '] > svg { display: none; }',
				'[' + NAV_ICON_MARKER + ']::before {',
				"  content: '';",
				'  flex: none;',
				'  width: 16px;',
				'  height: 16px;',
				'  background-color: currentColor;',
				'  -webkit-mask-image: ' + NAV_ICON_MASK + ';',
				'  mask-image: ' + NAV_ICON_MASK + ';',
				'  -webkit-mask-repeat: no-repeat;',
				'  mask-repeat: no-repeat;',
				'  -webkit-mask-position: center;',
				'  mask-position: center;',
				'  -webkit-mask-size: 16px 16px;',
				'  mask-size: 16px 16px;',
				'}',
			].join('\n')
		}

		function installSettingsNavIcon() {
			if (typeof document === 'undefined' || !document.body) return function () {}

			var tag = document.createElement('style')
			tag.id = 'dou-nav-icon-style'
			tag.textContent = navIconCss()
			document.head.appendChild(tag)

			var disposed = false
			var scheduled = false

			function sync() {
				scheduled = false
				if (disposed) return
				var wanted = String(SECTION_LABEL || '').trim()
				if (!wanted) return   // label 还没就绪：什么都不标记，绝不因空串认领整列
				var rows = document.querySelectorAll(NAV_ROW_SELECTOR)
				for (var i = 0; i < rows.length; i++) {
					var row = rows[i]
					if (String(row.textContent || '').trim() === wanted) row.setAttribute(NAV_ICON_MARKER, '')
					else row.removeAttribute(NAV_ICON_MARKER)   // 幂等：别行的陈旧标记一起清掉
				}
			}

			function schedule() {
				if (scheduled || disposed) return
				scheduled = true
				var qm = typeof queueMicrotask === 'function' ? queueMicrotask : function (f) { setTimeout(f, 0) }
				qm(sync)
			}

			sync()
			var observer = null
			try {
				observer = new MutationObserver(schedule)
				// subtree + characterData：设置页是挂到 body 的门户，切换语言会改写 label 文本
				observer.observe(document.body, { childList: true, subtree: true, characterData: true })
			} catch (e) { /* 观察失败：至少已同步过一次 */ }

			return function () {
				disposed = true
				try { if (observer) observer.disconnect() } catch (e) { /* ignore */ }
				var marked = document.querySelectorAll('[' + NAV_ICON_MARKER + ']')
				for (var i = 0; i < marked.length; i++) {
					try { marked[i].removeAttribute(NAV_ICON_MARKER) } catch (e) { /* ignore */ }
				}
				try { tag.remove() } catch (e) { /* ignore */ }
			}
		}

		/**
		 * 从宿主的 ThemeSnapshot 里取出 dark/light。
		 *
		 * **契约是从 DSH 源码里读出来的**（app.asar 内 `@deepseek-ai/dsh-client-ui-theme`）：
		 *
		 *   buildSnapshot() {
		 *     const resolvedId = preference === 'system'
		 *       ? (media.matches ? 'dark' : 'light') : preference
		 *     return { preference, fontSize, active: composeActive(active), themes, revision }
		 *   }
		 *
		 * 所以真正答案在 **snapshot.active.colorScheme**（'light' | 'dark'）——
		 * 嵌在 active 里，不在顶层。只读顶层会永远取不到（踩过）。
		 * 顶层另有 preference（可能是 'system'），那个不是答案。
		 */
		function pickScheme(obj) {
			if (!obj || typeof obj !== 'object') return null
			var keys = ['colorScheme', 'scheme', 'mode', 'appearance', 'type']
			for (var i = 0; i < keys.length; i++) {
				var v = obj[keys[i]]
				if (typeof v === 'string') {
					var s = v.toLowerCase()
					if (s === 'dark' || s === 'light') return s
				}
			}
			if (typeof obj.dark === 'boolean') return obj.dark ? 'dark' : 'light'
			if (typeof obj.isDark === 'boolean') return obj.isDark ? 'dark' : 'light'
			return null
		}

		function themeFromSnapshot(snap) {
			if (!snap || typeof snap !== 'object') return null
			// ① 宿主真实契约：active.colorScheme
			var nested = snap.active ?? snap.current ?? snap.theme ?? snap.resolved
			var fromNested = pickScheme(nested)
			if (fromNested) return fromNested
			// ② 顶层字段（老版本或第三方实现）
			var fromTop = pickScheme(snap)
			if (fromTop) return fromTop
			// ③ active.id 是 'dark' / 'light' 也能用
			var id = (snap.active && snap.active.id) || snap.id
			if (typeof id === 'string' && (id === 'dark' || id === 'light')) return id
			return null
		}

		/**
		 * 算颜色的相对亮度；**透明或解析不出来的返回 null**（表示"没测到"，继续往下走）。
		 *
		 * 这里栽过一次：`rgba(0,0,0,0)`（全透明）曾被算成 0.000 → 判定为暗色。
		 * 探针量到透明时本该"作废"，结果反而给出了错误结论，还挡住了后面的兜底。
		 */
		function luminance(color) {
			var s = String(color || '').trim()
			if (!s || s === 'transparent') return null
			var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
			if (hex) {
				var v = hex[1]
				if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2]
				return (0.299 * parseInt(v.slice(0, 2), 16) + 0.587 * parseInt(v.slice(2, 4), 16) + 0.114 * parseInt(v.slice(4, 6), 16)) / 255
			}
			var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(s)
			if (!m) return null
			var alpha = m[4] === undefined ? 1 : Number(m[4])
			if (!(alpha > 0.05)) return null        // 透明：当作没测到
			return (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255
		}

		var themeCtx = null            // 由 apply(ctx) 注入：宿主的 theme 服务
		var ctxRef = { current: null } // 整个 ctx，用来订阅 theme/change
		/**
		 * 兜底：往宿主文档里塞一个隐藏元素，量它**实际渲染出来的背景色**。
		 *
		 * 这一条不依赖任何变量名或值格式——浏览器已经把主题解析完了，量到的就是真相。
		 * DSH 的 theme 服务里 tokens 是「按 colorScheme 索引的原始值」，根元素上的
		 * --dsw-alias-bg-base 有可能取到空串（实测有过），所以必须有这条。
		 */
		function sampleHostBackground() {
			var probe = null
			try {
				probe = document.createElement('div')
				probe.setAttribute('aria-hidden', 'true')
				probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;' +
					'pointer-events:none;background:var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1, transparent))'
				document.body.appendChild(probe)
				var bg = getComputedStyle(probe).backgroundColor
				var l = luminance(bg)
				return { bg: bg, lum: l }
			} catch (e) {
				return { bg: null, lum: null }
			} finally {
				try { if (probe && probe.parentNode) probe.parentNode.removeChild(probe) } catch (e) { /* ignore */ }
			}
		}

		function detectTheme() {
			var diag = { snapshot: null, snapshotRaw: null, sample: null, cssVar: null, cssValue: null, system: null, decided: null }

			// ① 宿主 theme 服务（契约：snapshot.active.colorScheme 是 'light' | 'dark'）
			try {
				if (themeCtx && typeof themeCtx.getTheme === 'function') {
					var snap = themeCtx.getTheme()
					diag.snapshotRaw = snap ? Object.keys(snap).join(',') : '(null)'
					diag.snapshotActive = snap && snap.active ? Object.keys(snap.active).join(',') : null
					diag.snapshotPreference = snap ? snap.preference : null
					diag.snapshotActiveId = snap && snap.active ? snap.active.id : null
					diag.snapshot = themeFromSnapshot(snap)
					if (diag.snapshot) { diag.decided = diag.snapshot; diag.source = 'theme-service'; window.__OU_CLIENT_DIAG__ = diag; return diag.decided }
				}
			} catch (e) { diag.snapshotRaw = 'err: ' + String(e && e.message).slice(0, 60) }

			// ② 往宿主文档塞探针，量实际背景（最可靠的一条，绕开变量名与取值格式）
			try {
				var s = sampleHostBackground()
				diag.sample = s.bg
				if (s.lum !== null) {
					diag.decided = s.lum < 0.5 ? 'dark' : 'light'
					diag.source = 'host-sample'
					window.__OU_CLIENT_DIAG__ = diag
					return diag.decided
				}
			} catch (e) { /* 继续 */ }

			// ③ 直接读 CSS 变量（可能在根元素上取到空串，所以放在探针之后）
			try {
				var cs = getComputedStyle(document.documentElement)
				var names = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3']
				for (var i = 0; i < names.length; i++) {
					var raw = (cs.getPropertyValue(names[i]) || '').trim()
					var l = luminance(raw)
					if (l === null) continue
					diag.cssVar = names[i]; diag.cssValue = raw
					diag.decided = l < 0.5 ? 'dark' : 'light'
					diag.source = 'css-var'
					window.__OU_CLIENT_DIAG__ = diag
					return diag.decided
				}
			} catch (e) { /* 继续 */ }

			// ④ 系统偏好
			try {
				diag.system = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
			} catch (e) { diag.system = 'light' }
			diag.decided = diag.system
			diag.source = 'system'
			window.__OU_CLIENT_DIAG__ = diag
			return diag.decided
		}

		function Panel() {
			var theme = detectTheme()
			var ref = React.useRef(null)

			// 宿主切主题时跟着换。优先订阅宿主的 theme/change 事件（dshmarket 用的就是这个），
			// 拿不到事件源再退回轮询。
			React.useEffect(function () {
				function apply(t) {
					var f = ref.current
					if (f) f.src = PANEL_URL + '?theme=' + t
				}
				var last = detectTheme()
				var off = null
				try {
					if (ctxRef.current && typeof ctxRef.current.on === 'function') {
						off = ctxRef.current.on('theme/change', function () {
							var t = detectTheme()
							if (t !== last) { last = t; apply(t) }
						})
					}
				} catch (e) { off = null }

				// 订阅拿不到时也有兜底，反正代价很低
				var timer = setInterval(function () {
					var t = detectTheme()
					if (t !== last) { last = t; apply(t) }
				}, 1500)

				return function () {
					clearInterval(timer)
					try { if (typeof off === 'function') off() } catch (e) { /* ignore */ }
				}
			}, [])

			return h('iframe', {
				ref: ref,
				className: 'dou-frame',
				title: SECTION_LABEL,
				src: PANEL_URL + '?theme=' + theme,
			})
		}

		function installStyle() {
			if (document.getElementById('dou-style')) return
			var el = document.createElement('style')
			el.id = 'dou-style'
			el.textContent = '.dou-frame{width:100%;height:1180px;border:0;display:block;background:transparent}'
			document.head.appendChild(el)
		}

		function registerAll(ctx) {
			var slots = ctx.slots
			var disposers = []
			disposers.push(slots.inject('settings.section', function () {
				return slots.register({
					name: 'settings.section',
					id: 'official-usage-settings',
					order: 23,
					label: function () { return SECTION_LABEL },
				}, Panel)
			}))
			// 图标补丁放在分区注册之后：必须先有分区才有导航行
			disposers.push(installSettingsNavIcon())
			return function () {
				for (var i = 0; i < disposers.length; i++) {
					try { disposers[i]() } catch (e) { /* ignore */ }
				}
			}
		}

		function start(ctx) {
			// 宿主的 theme 服务：dshmarket 声明 inject 里有 'theme'，用的就是 ctx.theme.getTheme()
			ctxRef.current = ctx
			try { themeCtx = ctx && ctx.theme ? ctx.theme : null } catch (e) { themeCtx = null }
			installStyle()
			return registerAll(ctx)
		}

		// ⚠️ 必须是 export const（注入器骨架按文本校验）
		// theme 加进 inject：拿不到也不会致命（detectTheme 会依次退回 CSS 变量和系统偏好）
		return {
			name: PLUGIN_ID,
			inject: ['slots', 'theme'],
			apply: function (ctx) {
				ctx.effect
					? ctx.effect(function () { return start(ctx) }, PLUGIN_ID + ': settings section')
					: start(ctx)
			},
		}
	},
})
