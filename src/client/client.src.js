/**
 * dsh-official-usage —— client 侧（设置页「平台用量」分区）
 *
 * ⚠️ 这个文件是**源文件**：`plugin/client/client.js` 由 tools/build-panel.mjs 生成，
 *    不要把改动写进产物里（会在下一次构建被覆盖）。
 *
 * 面板怎么进来的：**Shadow DOM**，不是 iframe。
 *   早先用 iframe，是因为面板有一整套自己的 CSS，怕污染宿主。代价是：
 *     · iframe 是独立文档 → 拿不到宿主的 CSS 变量、字体、color-scheme；
 *     · 面板里的 backdrop-filter 只能糊自己文档里的东西 → 壁纸插件的玻璃在面板里失效；
 *     · 画布默认是白的 → 面板背景一旦透明就是白底（2026-10-03 那个 bug 的根源）。
 *   Shadow DOM 把这两件事同时解决：CSS 依旧完全隔离（外面的规则进不来、里面的出不去），
 *   但**自定义属性与可继承属性照常继承**，于是：
 *     · 背景直接用宿主的 --dsw-alias-bg-base —— 壁纸插件激活时它自己就是 transparent，
 *       壁纸于是透进面板；
 *     · 卡片的 backdrop-filter 糊的就是真壁纸（同一个文档，同一套 backdrop root）；
 *     · 壁纸插件改写过的 --we-* / --dsw-alias-label-* 也直接可用，无需转发。
 *   主题判断也随之收敛成一行：DSH 自己的标记 body[data-ds-dark-theme] 就是答案
 *   （ui-layout 的 theme-presenter 维护它，宿主 CSS 也用它），不需要再猜。
 *
 * 外观为什么能免重启：CSS/HTML 另外出一份 lib/panel-assets.json，挂载时 no-store 拉一次，
 *   版本对得上就整块重铺（脚本仍是内嵌的那份，契约一致）；**只有脚本也变了才需要重启**。
 */
window.__ModuleLoader__.load({
	id: 'dsh-official-usage',
	factory: (require) => {
		var React = require('react')
		var h = React.createElement

		var PLUGIN_ID = 'dsh-official-usage'
		var SECTION_LABEL = '平台用量'
		var STATE_URL = '/dsh-official-usage/api/state'
		var REFRESH_URL = '/dsh-official-usage/api/refresh'
		var PANEL_ASSETS_URL = '/dsh-official-usage/panel-assets.json'

		// ------------------------------------------------------------------
		// 构建时注入：面板样式 / 面板结构 / 面板脚本 + 两个版本号
		//   CSS 已由构建脚本改成 shadow 版（:root → :host 等）
		//   JS  已由构建脚本作用域化（id 查询走面板根、监听器挂在面板根上）
		// 都是纯字面量，运行时不做字符串拼接，也不用 eval。
		// ------------------------------------------------------------------
		var PANEL_CSS = /*__OU_PANEL_CSS__*/null
		var PANEL_HTML = /*__OU_PANEL_HTML__*/null
		var PANEL_JS = /*__OU_PANEL_JS__*/null
		var PANEL_CSS_REV = /*__OU_PANEL_CSS_REV__*/null
		var PANEL_JS_REV = /*__OU_PANEL_JS_REV__*/null

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

		// ------------------------------------------------------------------
		// 宿主状态：两个标记，直接读 DSH / 壁纸插件自己维护的属性
		//   body[data-ds-dark-theme]   深色主题（ui-layout 的 theme-presenter 维护，宿主 CSS 也用它选调色板）
		//   body[data-we-wallpaper]    壁纸插件已在跑（它把 --dsw-alias-bg-base 改成了 transparent）
		// ------------------------------------------------------------------
		var themeCtx = null
		var ctxRef = { current: null }

		function themeFromSnapshot(snap) {
			try {
				if (!snap || typeof snap !== 'object') return null
				var active = snap.active
				if (active && typeof active.colorScheme === 'string') return active.colorScheme
				if (active && (active.id === 'dark' || active.id === 'light')) return active.id
				if (snap.preference === 'dark' || snap.preference === 'light') return snap.preference
			} catch (e) { /* ignore */ }
			return null
		}

		/** 读宿主当前的深浅色。DOM 标记优先——它才是真正决定配色的那个。 */
		function hostIsDark() {
			try {
				var body = document.body
				if (body && typeof body.hasAttribute === 'function') {
					if (body.hasAttribute('data-ds-dark-theme')) return true
					// body 上没有任何标记、或明确没有暗色标记：以 theme 服务为准（极早期 DOM 还没标记）
					if (themeCtx && typeof themeCtx.getTheme === 'function') {
						var t = themeFromSnapshot(themeCtx.getTheme())
						if (t === 'dark') return true
						if (t === 'light') return false
					}
					if (document.documentElement && document.documentElement.getAttribute) {
						// 有些壳会把来源写在根元素上：light / dark / system
						var src = document.documentElement.getAttribute('data-ds-theme-source')
						if (src === 'dark') return true
						if (src === 'light') return false
					}
					return false
				}
			} catch (e) { /* ignore */ }
			try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch (e) { return false }
		}

		function bodyHas(attr) {
			try { return !!(document.body && document.body.hasAttribute && document.body.hasAttribute(attr)) } catch (e) { return false }
		}

		/** 把宿主的两个标记镜像到 shadow 宿主元素上——shadow 内部没法选中祖先，只能由外面写进来。 */
		function syncHostMarks(host) {
			if (!host || !host.setAttribute) return
			var dark = hostIsDark()
			if (host.getAttribute('data-theme') !== (dark ? 'dark' : 'light')) host.setAttribute('data-theme', dark ? 'dark' : 'light')
			if (bodyHas('data-we-wallpaper')) {
				if (!host.hasAttribute('data-we')) host.setAttribute('data-we', '')
			} else if (host.hasAttribute && host.hasAttribute('data-we')) {
				host.removeAttribute('data-we')
			}
		}

		// ------------------------------------------------------------------
		// 面板：一个宿主 div + shadow root + 铺在里面的面板根节点
		// ------------------------------------------------------------------
		/**
		 * 用给定资产在 shadow root 里铺好面板，并跑一遍面板脚本。
		 * 面板脚本拿到的「根」是 holder（不是 shadow root）：重铺时换一个 holder，
		 * 挂在它身上的事件委托随之作废，不会攒出重复监听。
		 */
		function paintPanel(host, assets) {
			var root = host.shadowRoot
			if (!root) {
				try { root = host.attachShadow({ mode: 'open' }) } catch (e) { return null }
			}
			if (!root) return null

			while (root.firstChild) root.removeChild(root.firstChild)

			var style = document.createElement('style')
			style.setAttribute('data-ou', 'style')
			style.textContent = assets.css
			root.appendChild(style)

			var holder = document.createElement('div')
			holder.setAttribute('data-ou', 'panel')
			holder.innerHTML = assets.html
			root.appendChild(holder)

			var err = document.createElement('div')
			err.setAttribute('data-ou', 'error')
			err.setAttribute('hidden', '')
			err.style.cssText = 'padding:48px 4px;text-align:center;color:var(--dim);font-size:13px'
			root.appendChild(err)

			// 面板脚本在面板根里跑：window 传一个空壳，它的 window.__officialUsage* 出口就落在这里
			var api = PANEL_JS(holder, {}, document)
			return { root: root, holder: holder, api: api }
		}

		function showError(root, message) {
			var err = root.querySelector('[data-ou="error"]')
			if (!err) return
			err.textContent = '取数据失败：' + message
			err.removeAttribute('hidden')
		}

		function hideError(root) {
			var err = root.querySelector('[data-ou="error"]')
			if (err) err.setAttribute('hidden', '')
		}

		function loadData(painted, force) {
			if (!painted) return Promise.resolve()
			return fetch(STATE_URL + (force ? '?fresh=1' : ''), { cache: 'no-store' })
				.then(function (r) { return r.json() })
				.then(function (d) {
					if (!d || d.error || !d.days || !d.days.length) throw new Error((d && d.error) || '宿主还没取到平台用量数据')
					painted.generatedAt = d.generatedAt || null
					hideError(painted.root)
					var api = painted.api
					if (api && typeof api.__officialUsageSetData === 'function') api.__officialUsageSetData(d)
				})
				.catch(function (e) { showError(painted.root, String((e && e.message) || e)) })
		}

		/**
		 * 面板开着的时候自己保持新鲜。
		 *
		 * 以前只在挂载时取一次数：设置页开着不动，格子就一直是「打开那一刻」的快照 ——
		 * 新的一天不会出现新格子，今天那格也不会变绿（2026-10-04 用户报的）。
		 * 现在的规矩：
		 *   · 数据还没过期（< 10 分钟，与宿主的缓存 TTL 对齐）→ 只重取缓存，几毫秒
		 *   · 数据过期了 → 先让宿主重采（/api/refresh，宿主那边有并发与 7 天窗口分片，
		 *     不会因为多开几个面板就把平台接口打爆），再取回来重画
		 * 于是「今天这一格的绿色」最多 10 分钟就会跟上，「新的一天」最多 10 分钟就会出现。
		 */
		var DATA_POLL_MS = 5 * 60 * 1000
		var DATA_STALE_MS = 10 * 60 * 1000

		function pollData(host) {
			var painted = host && host.__ouPainted
			if (!painted) return
			var at = painted.generatedAt ? Date.parse(painted.generatedAt) : 0
			if (at && (Date.now() - at) < DATA_STALE_MS) { loadData(painted, false); return }
			fetch(REFRESH_URL, { cache: 'no-store' })
				.catch(function () { /* 重采失败也要把手上这份显示出来 */ })
				.then(function () { return loadData(host.__ouPainted, false) })
		}

		/**
		 * 拉一次运行时资产（宿主路由，no-store）：
		 *   · 脚本版本一致 → CSS/HTML 整块重铺 ⇒ **改外观不用重启**
		 *   · 脚本也变了   → 只换 CSS（外观立即生效），结构/逻辑等下次重启
		 * 拉不到就继续用内嵌的那份，面板照常可用。
		 */
		function refreshPanelAssets(host) {
			return fetch(PANEL_ASSETS_URL, { cache: 'no-store' })
				.then(function (r) { return r.json() })
				.then(function (a) {
					if (!a || typeof a.css !== 'string' || typeof a.html !== 'string') return
					var live = host.__ouPainted
					if (!live) return
					if (a.cssRev === PANEL_CSS_REV && a.jsRev === PANEL_JS_REV) return
					if (a.jsRev === PANEL_JS_REV) {
						var again = paintPanel(host, { css: a.css, html: a.html })
						if (!again) return
						host.__ouPainted = again
						syncHostMarks(host)
						loadData(again, false)
					} else {
						var st = live.root.querySelector('style[data-ou="style"]')
						if (st) st.textContent = a.css
					}
				})
				.catch(function () { /* 用内嵌的那份 */ })
		}

		function mountPanel(host) {
			var painted = paintPanel(host, { css: PANEL_CSS, html: PANEL_HTML })
			if (!painted) return null
			host.__ouPainted = painted
			syncHostMarks(host)
			loadData(painted, false)
			refreshPanelAssets(host)
			return painted
		}

		function Panel() {
			var hostRef = React.useRef(null)

			React.useEffect(function () {
				var host = hostRef.current
				if (!host) return
				mountPanel(host)

				// 宿主换主题 / 开关壁纸：两个属性都在 body 上，一次 MutationObserver 全包
				var observer = null
				try {
					observer = new MutationObserver(function () { syncHostMarks(host) })
					observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-we-wallpaper'] })
				} catch (e) { /* 观察不到就靠下面的轮询 */ }

				var off = null
				try {
					if (ctxRef.current && typeof ctxRef.current.on === 'function') {
						off = ctxRef.current.on('theme/change', function () { syncHostMarks(host) })
					}
				} catch (e) { off = null }

				var timer = setInterval(function () { syncHostMarks(host) }, 2000)

				// 数据自己保持新鲜：每 5 分钟看一次（过期就让宿主重采），
				// 窗口重新可见时也看一次（从别的窗口切回来时最可能是"很久没更新"的那一下）
				var dataTimer = setInterval(function () { pollData(host) }, DATA_POLL_MS)
				var onVisible = function () { if (!document.hidden) pollData(host) }
				try { document.addEventListener('visibilitychange', onVisible) } catch (e) { /* ignore */ }

				return function () {
					clearInterval(timer)
					clearInterval(dataTimer)
					try { document.removeEventListener('visibilitychange', onVisible) } catch (e) { /* ignore */ }
					try { if (observer) observer.disconnect() } catch (e) { /* ignore */ }
					try { if (typeof off === 'function') off() } catch (e) { /* ignore */ }
				}
			}, [])

			return h('div', { ref: hostRef, className: 'dou-host' })
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
			ctxRef.current = ctx
			try { themeCtx = ctx && ctx.theme ? ctx.theme : null } catch (e) { themeCtx = null }
			return registerAll(ctx)
		}

		// ⚠️ 必须是 export const（注入器骨架按文本校验）
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
