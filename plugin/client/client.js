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
		 * 读 DSH 当前主题，显式告诉面板。
		 *
		 * 为什么不靠面板自己判断：DSH 的主题是**应用内设置**（右上角切换），和系统主题
		 * 可以不一致；面板在 iframe 里只能看 prefers-color-scheme，猜就会错配——实际出现过
		 * 「DSH 亮色、面板内部认到暗色」的画面（背景白、格子暗）。
		 * 这里优先问宿主提供的 CSS 变量（--dsw-alias-bg-base 等），拿不到再退回系统偏好。
		 */
		function detectTheme() {
			try {
				var cs = getComputedStyle(document.documentElement)
				var names = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-3']
				for (var i = 0; i < names.length; i++) {
					var v = (cs.getPropertyValue(names[i]) || '').trim()
					var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v)
					if (!m) continue
					var lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255
					return lum < 0.5 ? 'dark' : 'light'
				}
			} catch (e) { /* 拿不到就往下走 */ }
			try {
				return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
			} catch (e) { return 'light' }
		}

		function Panel() {
			var theme = detectTheme()
			var ref = React.useRef(null)

			// 宿主切换主题时跟着换：监听 <html> 的属性变化，重设 iframe 的地址。
			// 这样面板始终和 DSH 一致，不需要用户手动刷新。
			React.useEffect(function () {
				var now = detectTheme()
				var last = now
				var timer = setInterval(function () {
					var t = detectTheme()
					if (t !== last) {
						last = t
						var f = ref.current
						if (f) f.src = PANEL_URL + '?theme=' + t
					}
				}, 1500)
				return function () { clearInterval(timer) }
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
			installStyle()
			return registerAll(ctx)
		}

		// ⚠️ 必须是 export const（注入器骨架按文本校验）
		return {
			name: PLUGIN_ID,
			inject: ['slots'],
			apply: function (ctx) {
				ctx.effect
					? ctx.effect(function () { return start(ctx) }, PLUGIN_ID + ': settings section')
					: start(ctx)
			},
		}
	},
})
