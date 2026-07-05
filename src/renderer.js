'use strict'

// ─── Constants ─────────────────────────────────────────────────────────────
const VIDEO_SITES = [
  'youtube.com', 'youtu.be', 'twitch.tv', 'vimeo.com',
  'netflix.com', 'primevideo.com', 'disneyplus.com',
  'hbomax.com', 'max.com', 'globoplay.globo.com',
  'crunchyroll.com', 'funimation.com', 'dailymotion.com',
]

const SEARCH_ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave:      'https://search.brave.com/search?q=',
  startpage:  'https://www.startpage.com/search?q=',
  kagi:       'https://kagi.com/search?q=',
  google:     'https://www.google.com/search?q=',
}

// ─── Preferences (in-memory, persist via localStorage) ─────────────────────
const defaultPrefs = {
  theme: 'dark',
  accent: '#007AFF',
  adblock: true,
  trackers: true,
  fingerprint: true,
  https: true,
  '3p-cookies': true,
  webrtc: true,
  privacyLevel: 'aggressive',
  memorySaver: true,
  bgThrottle: true,
  preload: false,
  audioOnlyAuto: false,
  audioOnlyBtn: true,
  gpu: true,
  smooth: true,
  searchEngine: 'duckduckgo',
  suggestions: true,
  selectionSearch: true,
  applePasswords: true,
  autofill: true,
  savePasswords: false,
  breachAlerts: true,
  biometric: true,
  vpnIncognito: true,
  vpnAlways: false,
  vpnLocation: 'São Paulo, BR',
  animations: true,
  devtools: true,
  verbose: false,
  clearOnClose: false,
  bookmarksBar: false,
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('lumen_prefs') || '{}')
    return { ...defaultPrefs, ...saved }
  } catch { return { ...defaultPrefs } }
}

function savePrefs(prefs) {
  localStorage.setItem('lumen_prefs', JSON.stringify(prefs))
}

// ─── Tab ───────────────────────────────────────────────────────────────────
let tabCounter = 0

class Tab {
  constructor({ incognito = false, url = '' } = {}) {
    this.id = ++tabCounter
    this.url = url
    this.title = url ? 'Carregando…' : 'Nova Aba'
    this.favicon = null
    this.isLoading = false
    this.incognito = incognito
    this.canGoBack = false
    this.canGoForward = false
    this.audioOnly = false
    this.isVideoSite = false
    this.webviewEl = null
    this.tabEl = null
  }
}

// ─── Browser ───────────────────────────────────────────────────────────────
class LumenBrowser {
  constructor() {
    this.tabs = []
    this.activeId = null
    this.blockedCount = 0
    this.prefs = loadPrefs()
    this.isSettingsOpen = false

    this._bindDOM()
    this._bindEvents()
    this._setupIPC()
    this._applyPrefs()
    this._initLanguage()
    this._updateGreeting()
    this._initContextMenu()
    this._initPlatform()
    this._initUpdater()
    this._initBookmarks()

    this._restoreSession()
  }

  _restoreSession() {
    try {
      const session = JSON.parse(localStorage.getItem('lumen_session') || 'null')
      if (session?.tabs?.length) {
        session.tabs.forEach(t => this.createTab({ url: t.url || null }))
        return
      }
    } catch {}
    this.createTab()
  }

  _saveSession() {
    const tabs = this.tabs
      .filter(t => !t.incognito && t.url && !t.url.startsWith('lumen://'))
      .map(t => ({ url: t.url }))
    localStorage.setItem('lumen_session', JSON.stringify({ tabs }))
  }

  // ── DOM refs ─────────────────────────────────────────────────────────────
  _bindDOM() {
    this.$ = (id) => document.getElementById(id)
    this.tabsEl       = this.$('tabs')
    this.webviewArea  = this.$('webview-area')
    this.ntpEl        = this.$('ntp')
    this.settingsEl   = this.$('settings-page')
    this.addrInput    = this.$('address-input')
    this.backBtn      = this.$('back-btn')
    this.forwardBtn   = this.$('forward-btn')
    this.refreshBtn   = this.$('refresh-btn')
    this.newTabBtn    = this.$('new-tab-btn')
    this.progressBar  = this.$('progress-bar')
    this.blockedEl    = this.$('blocked-count')
    this.ntpPrivMsg   = this.$('ntp-priv-msg')
    this.ntpSearchInput = this.$('ntp-search-input')
    this.privacyPanel = this.$('privacy-panel')
    this.audioOnlyBtn = this.$('audio-only-btn')
    this.vpnStrip     = this.$('vpn-strip')
    this.vpnLocEl     = this.$('vpn-location')
    this.browserEl    = this.$('browser')
  }

  // ── Events ───────────────────────────────────────────────────────────────
  _bindEvents() {
    this.newTabBtn.addEventListener('click', () => this.createTab())
    this.$('incognito-btn')?.addEventListener('click', () => this.createTab({ incognito: true }))

    this.backBtn.addEventListener('click', () => this._activeWV()?.goBack())
    this.forwardBtn.addEventListener('click', () => this._activeWV()?.goForward())
    this.refreshBtn.addEventListener('click', () => {
      const tab = this._activeTab()
      if (!tab) return
      if (tab.isLoading) this._activeWV()?.stop()
      else this._activeWV()?.reload()
    })

    this.addrInput.addEventListener('focus', () => {
      this.addrInput.select()
      this._showSuggestions(this.addrInput.value)
    })
    this.addrInput.addEventListener('input', () => this._showSuggestions(this.addrInput.value))
    this.addrInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this._moveSuggestion(1); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this._moveSuggestion(-1); return }
      if (e.key === 'Enter') {
        const active = this.$('addr-suggestions')?.querySelector('.addr-sug-item.active')
        const val = active ? active.dataset.url || active.dataset.query : this.addrInput.value
        this._hideSuggestions()
        this.navigate(val || this.addrInput.value)
        return
      }
      if (e.key === 'Escape') {
        this._hideSuggestions()
        this.addrInput.blur()
        this._syncAddressBar()
      }
    })
    this.addrInput.addEventListener('blur', () => setTimeout(() => this._hideSuggestions(), 150))

    this.ntpSearchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.navigate(this.ntpSearchInput.value); this.ntpSearchInput.value = '' }
    })

    this.$('privacy-badge').addEventListener('click', () => {
      const open = !this.privacyPanel.classList.contains('visible')
      this._closeAllPanels()
      if (open) this.privacyPanel.classList.add('visible')
    })
    this.$('close-pp').addEventListener('click', () => this.privacyPanel.classList.remove('visible'))

    this.$('settings-btn').addEventListener('click', () => this._toggleSettings())

    this.audioOnlyBtn.addEventListener('click', () => this._toggleAudioOnly())

    // Settings navigation
    document.querySelectorAll('.settings-nav').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.settings-nav').forEach(b => b.classList.remove('active'))
        document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'))
        btn.classList.add('active')
        this.$(`section-${btn.dataset.section}`)?.classList.add('active')
      })
    })

    // NTP tiles — dynamic render
    this._renderNTPTiles()


    // NTP Edit button / panel
    this.$('ntp-edit-btn')?.addEventListener('click', () => {
      const panel = this.$('ntp-edit-panel')
      const open = panel?.classList.contains('hidden')
      this._closeAllPanels()
      if (open) panel?.classList.remove('hidden')
    })
    document.addEventListener('click', (e) => {
      const panel = this.$('ntp-edit-panel')
      const btn   = this.$('ntp-edit-btn')
      if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn) {
        panel.classList.add('hidden')
      }
    })
    // Edit panel section toggles
    document.querySelectorAll('.nep-item').forEach(item => {
      item.addEventListener('click', () => {
        const check = item.querySelector('.nep-check')
        check?.classList.toggle('active')
        const section = this.$(`ntp-section-${item.dataset.section}`)
        if (section) section.style.display = check?.classList.contains('active') ? '' : 'none'
      })
    })
    // Edit panel bg picker
    document.querySelectorAll('.nep-bg-opt:not(#nep-bg-file-btn)').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.nep-bg-opt').forEach(o => o.classList.remove('active'))
        opt.classList.add('active')
        const bg = opt.dataset.bg || 'none'
        this._applyNtpBg(bg === 'none' ? null : bg)
        localStorage.setItem('lumen_ntp_bg', bg)
      })
    })
    this.$('nep-bg-file-btn')?.addEventListener('click', async () => {
      const result = await window.lumen?.pickBgImage?.()
      if (!result) return
      document.querySelectorAll('.nep-bg-opt').forEach(o => o.classList.remove('active'))
      this.$('nep-bg-file-btn')?.classList.add('active')
      this._applyNtpBg(`url("${result}")`)
      localStorage.setItem('lumen_ntp_bg', `url("${result}")`)
    })
    // Restore saved bg
    const savedBg = localStorage.getItem('lumen_ntp_bg')
    if (savedBg && savedBg !== 'none') this._applyNtpBg(savedBg)
    // Privacy Report "Ver mais" → privacy panel
    this.$('ntp-priv-more-btn')?.addEventListener('click', () => {
      this.$('privacy-panel')?.classList.add('open')
    })

    // Toggles in settings
    document.querySelectorAll('.toggle[id^="pref-"]').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const key = toggle.id.replace('pref-', '')
        const mappedKey = this._mapPrefKey(key)
        toggle.classList.toggle('active')
        this.prefs[mappedKey] = toggle.classList.contains('active')
        savePrefs(this.prefs)
        this._applyDynamicPref(mappedKey)
      })
    })

    // Privacy panel toggles
    document.querySelectorAll('#pp-toggles .toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('active')
        const key = toggle.dataset.pref
        this.prefs[key] = toggle.classList.contains('active')
        savePrefs(this.prefs)
      })
    })

    // Accent colors
    document.querySelectorAll('.accent-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.accent-dot').forEach(d => d.classList.remove('active'))
        dot.classList.add('active')
        this.prefs.accent = dot.dataset.color
        savePrefs(this.prefs)
        document.documentElement.style.setProperty('--accent', dot.dataset.color)
      })
    })

    // Theme selector
    this.$('pref-theme')?.addEventListener('change', (e) => {
      this.prefs.theme = e.target.value
      savePrefs(this.prefs)
      this._applyTheme()
    })

    // Font size selector
    this.$('pref-font-size')?.addEventListener('change', (e) => {
      this.prefs.fontSize = e.target.value
      savePrefs(this.prefs)
      this._applyFontSize()
    })

    // Search engine selector
    document.querySelectorAll('.search-engine-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.search-engine-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        this.prefs.searchEngine = btn.dataset.engine
        savePrefs(this.prefs)
      })
    })

    // Privacy level
    document.querySelectorAll('.privacy-level').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.privacy-level').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        this.prefs.privacyLevel = btn.dataset.level
        savePrefs(this.prefs)
      })
    })

    // VPN locations
    document.querySelectorAll('.vpn-loc').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.vpn-loc').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        this.prefs.vpnLocation = btn.dataset.loc
        savePrefs(this.prefs)
        this.vpnLocEl.textContent = btn.dataset.loc
      })
    })

    // Extensions panel
    const extPanel = this.$('ext-panel')
    this.$('ext-btn')?.addEventListener('click', () => {
      const open = extPanel?.classList.contains('hidden')
      this._closeAllPanels()
      if (open) extPanel?.classList.remove('hidden')
    })
    this.$('ext-close-btn')?.addEventListener('click', () => extPanel?.classList.add('hidden'))
    document.querySelectorAll('.ext-toggle').forEach(t => {
      t.addEventListener('click', () => t.classList.toggle('active'))
    })
    this.$('ext-load-btn')?.addEventListener('click', async () => {
      const result = await window.lumen?.loadExtensionFolder?.()
      if (!result) return
      if (result.error) { alert('Erro ao carregar extensão: ' + result.error); return }
      this._addLoadedExtensionToPanel(result)
    })
    this.$('ext-chrome-btn')?.addEventListener('click', () => {
      this.createTab({ url: 'https://chromewebstore.google.com' })
      this.$('ext-panel')?.classList.add('hidden')
    })
    // Refresh loaded extensions list whenever panel opens
    this.$('ext-btn')?.addEventListener('click', () => this._refreshLoadedExtensions())
    window.lumen?.getExtensions?.().then(exts => { if (exts?.length) exts.forEach(e => this._addLoadedExtensionToPanel(e)) })

    // Open chrome://settings
    this.$('open-chrome-settings')?.addEventListener('click', () => {
      this.navigate('chrome://settings')
      this._toggleSettings(false)
    })

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 't') { e.preventDefault(); this.createTab() }
      if (e.key === 'w') { e.preventDefault(); this.closeTab(this.activeId) }
      if (e.key === 'l') { e.preventDefault(); this.addrInput.focus(); this.addrInput.select() }
      if (e.key === 'r') { e.preventDefault(); this._activeWV()?.reload() }
      if (e.key === 'n' && e.shiftKey) { e.preventDefault(); this.createTab({ incognito: true }) }
      if (e.key === ',') { e.preventDefault(); this._toggleSettings() }
      if (e.key === ']') { e.preventDefault(); this._switchTab(1) }
      if (e.key === '[') { e.preventDefault(); this._switchTab(-1) }
      if (e.key === '=') { e.preventDefault(); this._zoom(1) }
      if (e.key === '-') { e.preventDefault(); this._zoom(-1) }
      if (e.key === '0') { e.preventDefault(); this._zoom(0) }
      if (e.key === 'd') { e.preventDefault(); this._pinCurrentTab() }
      if (e.key === 'f') { e.preventDefault(); this._openFind() }
      if (e.key === 'g' && e.shiftKey) { e.preventDefault(); this._findStep(-1) }
      if (e.key === 'g') { e.preventDefault(); this._findStep(1) }
    })

    // Find bar controls
    const findInput = this.$('find-input')
    this.$('find-next')?.addEventListener('click', () => this._findStep(1))
    this.$('find-prev')?.addEventListener('click', () => this._findStep(-1))
    this.$('find-close')?.addEventListener('click', () => this._closeFind())
    findInput?.addEventListener('input', () => this._doFind())
    findInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._findStep(e.shiftKey ? -1 : 1) }
      if (e.key === 'Escape') this._closeFind()
    })
  }

  _mapPrefKey(htmlKey) {
    const map = {
      'memory-saver': 'memorySaver', 'bg-throttle': 'bgThrottle',
      'audio-only-auto': 'audioOnlyAuto', 'audio-only-btn': 'audioOnlyBtn',
      'apple-passwords': 'applePasswords', 'save-passwords': 'savePasswords',
      'breach-alerts': 'breachAlerts', 'vpn-incognito': 'vpnIncognito',
      'vpn-always': 'vpnAlways', 'clear-on-close': 'clearOnClose',
      'bookmarks-bar': 'bookmarksBar', 'selection-search': 'selectionSearch',
      '3p-cookies': '3p-cookies',
    }
    return map[htmlKey] || htmlKey
  }

  _applyDynamicPref(key) {
    if (key === 'accent') {
      document.documentElement.style.setProperty('--accent', this.prefs.accent)
    }
    if (key === 'bookmarksBar') {
      const bmBar = this.$('bm-bar')
      if (bmBar) bmBar.classList.toggle('hidden', !this.prefs.bookmarksBar)
    }
  }

  // ── IPC ──────────────────────────────────────────────────────────────────
  _setupIPC() {
    window.lumen?.onAdBlocked((count) => {
      this.blockedCount = count

      // Flip number animation
      const el = this.blockedEl
      el.classList.remove('flip')
      void el.offsetWidth                    // reflow to restart animation
      el.textContent = count > 999 ? '999+' : count
      el.classList.add('flip')

      // Badge pulse every 5 blocks to avoid too much noise
      if (count % 5 === 0) {
        const badge = this.$('privacy-badge')
        badge?.classList.remove('pulse')
        void badge?.offsetWidth
        badge?.classList.add('pulse')
      }

      if (this.ntpPrivMsg) this.ntpPrivMsg.innerHTML = `O Lumen bloqueou <strong>${count.toLocaleString()}</strong> rastreadores nos últimos 30 dias.`
      const statNum = this.$('ntp-stat-num'); if (statNum) statNum.textContent = count.toLocaleString()
      this.$('pp-ads').textContent = Math.floor(count * 0.55)
      this.$('pp-trackers').textContent = Math.floor(count * 0.45)
      const kb = (count * 5.3).toFixed(0)
      this.$('pp-bandwidth').textContent = kb > 999 ? `${(kb / 1024).toFixed(1)}MB` : `${kb}KB`
    })
  }

  // ── Tab management ───────────────────────────────────────────────────────
  createTab({ incognito = false, url = null } = {}) {
    const tab = new Tab({ incognito, url: url || '' })
    this.tabs.push(tab)

    // DOM: tab button
    const el = this._buildTabEl(tab)
    tab.tabEl = el
    this.tabsEl.appendChild(el)

    // Webview (if URL provided)
    if (url) {
      const wv = this._buildWebview(tab, url)
      tab.webviewEl = wv
      this.webviewArea.appendChild(wv)
    }

    this._activateTab(tab.id)
    return tab
  }

  closeTab(id) {
    const idx = this.tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    const tab = this.tabs[idx]

    // Switch focus immediately (before animation) so UX feels instant
    if (this.activeId === id && this.tabs.length > 1) {
      const candidates = this.tabs.filter(t => t.id !== id)
      const next = candidates[Math.max(0, idx - 1)] || candidates[0]
      if (next) this._activateTab(next.id)
    }

    // Remove from logical state right away
    this.tabs.splice(idx, 1)

    // Animate out, then remove DOM
    tab.tabEl?.classList.add('tab-closing')
    setTimeout(() => {
      tab.tabEl?.remove()
      tab.webviewEl?.remove()
      if (this.tabs.length === 0) this.createTab()
      this._saveSession()
    }, 150)
  }

  _activateTab(id) {
    // Deactivate previous
    if (this.activeId) {
      const prev = this._getTab(this.activeId)
      prev?.webviewEl?.classList.remove('active')
      prev?.tabEl?.classList.remove('active')
    }

    this.activeId = id
    const tab = this._getTab(id)

    this.ntpEl.classList.remove('active')
    this.settingsEl.classList.remove('active')
    this.isSettingsOpen = false

    if (tab?.webviewEl) {
      tab.webviewEl.classList.add('active')
    } else if (!this.isSettingsOpen) {
      this.ntpEl.classList.add('active')
      setTimeout(() => this.ntpSearchInput?.focus(), 80)
    }

    tab?.tabEl?.classList.add('active')

    // Incognito chrome
    const inc = tab?.incognito || false
    this.browserEl.classList.toggle('incognito', inc)
    this.$('vpn-strip').classList.toggle('visible', inc && this.prefs.vpnIncognito)
    this.$('vpn-btn')?.classList.toggle('hidden', !inc)
    this.vpnLocEl.textContent = this.prefs.vpnLocation

    this._syncAddressBar()
    this._updateNavBtns()
    this._checkVideoSite(tab)
  }

  _buildTabEl(tab) {
    const el = document.createElement('div')
    el.className = `tab${tab.incognito ? ' incognito' : ''}`
    el.dataset.tabId = tab.id
    el.setAttribute('role', 'tab')
    el.innerHTML = `
      <span class="tab-fav"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg></span>
      <span class="tab-title">${tab.incognito ? 'Incógnito' : 'Nova Aba'}</span>
      <button class="tab-x" title="Fechar">
        <svg width="11" height="11" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>`

    el.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-x')) this._activateTab(tab.id)
    })
    el.querySelector('.tab-x').addEventListener('click', (e) => {
      e.stopPropagation()
      this.closeTab(tab.id)
    })
    return el
  }

  _buildWebview(tab, url) {
    const wv = document.createElement('webview')
    wv.className = 'bwv'
    wv.src = this._resolveURL(url)
    wv.setAttribute('allowpopups', '')
    if (tab.incognito) wv.partition = `incognito-${tab.id}`

    wv.addEventListener('did-start-loading', () => {
      tab.isLoading = true
      if (tab.id === this.activeId) this._setLoading(true)
    })
    wv.addEventListener('did-stop-loading', () => {
      tab.isLoading = false
      if (tab.id === this.activeId) this._setLoading(false)
      this._updateNavBtns()
    })
    wv.addEventListener('did-navigate', (e) => {
      tab.url = e.url
      tab.canGoBack = wv.canGoBack()
      tab.canGoForward = wv.canGoForward()
      if (tab.id === this.activeId) {
        this._syncAddressBar()
        this._updateNavBtns()
        this._checkVideoSite(tab)
      }
      this._saveSession()
    })
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return
      tab.url = e.url
      tab.canGoBack = wv.canGoBack()
      tab.canGoForward = wv.canGoForward()
      if (tab.id === this.activeId) {
        this._syncAddressBar()
        this._updateNavBtns()
        this._checkVideoSite(tab)
      }
    })
    wv.addEventListener('page-title-updated', (e) => {
      tab.title = e.title
      const titleEl = tab.tabEl?.querySelector('.tab-title')
      if (titleEl) titleEl.textContent = e.title
      tab.tabEl?.setAttribute('title', e.title)
      // Update visit record with real title
      if (tab.url) this._updateVisitTitle(tab.url, e.title)
    })
    wv.addEventListener('page-favicon-updated', (e) => {
      if (!e.favicons?.[0]) return
      tab.favicon = e.favicons[0]
      const favEl = tab.tabEl?.querySelector('.tab-fav')
      if (favEl) favEl.innerHTML = `<img src="${tab.favicon}" width="13" height="13" onerror="this.style.display='none'">`
    })
    wv.addEventListener('new-window', (e) => {
      this.createTab({ url: e.url, incognito: tab.incognito })
    })

    wv.addEventListener('found-in-page', (e) => {
      if (tab.id !== this.activeId) return
      const { activeMatchOrdinal, matches } = e.result
      const statusEl = this.$('find-status')
      if (statusEl) statusEl.textContent = matches > 0 ? `${activeMatchOrdinal}/${matches}` : 'Nenhum'
    })

    wv.addEventListener('context-menu', (e) => {
      e.preventDefault()
      const p = e.params || {}
      this._showContextMenu(e.x ?? p.x ?? 0, e.y ?? p.y ?? 0, {
        linkURL: p.linkURL || '',
        selectionText: p.selectionText || ''
      })
    })

    return wv
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  navigate(input) {
    if (!input?.trim()) return
    // Special URLs
    if (input.trim() === 'lumen://settings') { this._toggleSettings(true); return }
    const url = this._resolveURL(input.trim())
    const tab = this._activeTab()
    if (!tab) return

    if (tab.webviewEl) {
      tab.webviewEl.loadURL(url)
    } else {
      const wv = this._buildWebview(tab, url)
      tab.webviewEl = wv
      this.webviewArea.appendChild(wv)
      this.ntpEl.classList.remove('active')
      wv.classList.add('active')
    }
    tab.url = url
    this.addrInput.value = url
    this.addrInput.blur()
    this._trackVisit(url)
  }

  // ── Address bar suggestions ──────────────────────────────────────────────
  _showSuggestions(query) {
    const el = this.$('addr-suggestions')
    if (!el || !this.prefs.suggestions) return
    const q = (query || '').trim().toLowerCase()
    const items = []

    // Visit history matches
    try {
      const visits = JSON.parse(localStorage.getItem('lumen_visits') || '{}')
      Object.values(visits)
        .filter(v => v.url?.toLowerCase().includes(q) || v.title?.toLowerCase().includes(q))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .forEach(v => items.push({ type: 'history', url: v.url, label: v.title || v.url }))
    } catch {}

    // Search suggestion at bottom if query is not a URL
    if (q && !q.includes('.')) {
      const engine = SEARCH_ENGINES[this.prefs.searchEngine] || SEARCH_ENGINES.duckduckgo
      items.push({ type: 'search', query: q, url: engine + encodeURIComponent(q), label: `Buscar "${query}"` })
    }

    if (items.length === 0) { el.classList.add('hidden'); return }

    el.innerHTML = ''
    items.forEach((item, i) => {
      const div = document.createElement('div')
      div.className = 'addr-sug-item'
      div.dataset.url = item.url
      if (item.query) div.dataset.query = item.url

      const iconSvg = item.type === 'search'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>'

      const label = item.label.replace(new RegExp(q, 'gi'), m => `<span class="addr-sug-match">${m}</span>`)
      div.innerHTML = `<span class="addr-sug-icon">${iconSvg}</span><span class="addr-sug-text"><div class="addr-sug-label">${label}</div>${item.type !== 'search' ? `<div class="addr-sug-url">${item.url}</div>` : ''}</span>`

      div.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this._hideSuggestions()
        this.navigate(item.url)
      })
      el.appendChild(div)
    })
    el.classList.remove('hidden')
  }

  _hideSuggestions() {
    this.$('addr-suggestions')?.classList.add('hidden')
  }

  _moveSuggestion(dir) {
    const el = this.$('addr-suggestions')
    if (!el || el.classList.contains('hidden')) return
    const items = el.querySelectorAll('.addr-sug-item')
    if (!items.length) return
    const cur = el.querySelector('.addr-sug-item.active')
    let idx = cur ? [...items].indexOf(cur) + dir : (dir > 0 ? 0 : items.length - 1)
    idx = Math.max(0, Math.min(items.length - 1, idx))
    items.forEach(i => i.classList.remove('active'))
    items[idx].classList.add('active')
    this.addrInput.value = items[idx].dataset.url || this.addrInput.value
  }

  _updateVisitTitle(url, title) {
    try {
      const u = new URL(url)
      const domain = u.hostname.replace(/^www\./, '')
      const visits = JSON.parse(localStorage.getItem('lumen_visits') || '{}')
      if (visits[domain]) { visits[domain].title = title; localStorage.setItem('lumen_visits', JSON.stringify(visits)) }
    } catch {}
  }

  _trackVisit(url) {
    try {
      if (!url || url.startsWith('lumen://') || url.startsWith('chrome://') || url.startsWith('about:')) return
      const u = new URL(url)
      const domain = u.hostname.replace(/^www\./, '')
      if (!domain) return
      const visits = JSON.parse(localStorage.getItem('lumen_visits') || '{}')
      visits[domain] = { count: ((visits[domain]?.count) || 0) + 1, url, title: domain }
      localStorage.setItem('lumen_visits', JSON.stringify(visits))
      this._renderNTPSuggested()
    } catch {}
  }

  // ── NTP tiles ────────────────────────────────────────────────────────────
  static get _defaultPinned() {
    return [
      { url: 'https://github.com',       label: 'GitHub',     bg: '#24292e', svg: '<svg width="34" height="34" viewBox="0 0 24 24" fill="white"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>' },
      { url: 'https://duckduckgo.com',   label: 'DuckDuckGo', bg: '#de5833', svg: '<svg width="34" height="34" viewBox="0 0 100 100" fill="white"><circle cx="50" cy="50" r="45"/><text x="50" y="67" text-anchor="middle" font-size="52" font-family="Georgia,serif" fill="#de5833" font-weight="bold">D</text></svg>' },
      { url: 'https://youtube.com',      label: 'YouTube',    bg: '#FF0000', svg: '<svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>' },
      { url: 'https://reddit.com',       label: 'Reddit',     bg: '#FF4500', svg: '<svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>' },
      { url: 'https://proton.me',        label: 'ProtonMail', bg: '#6D4AFF', svg: '<svg width="34" height="34" viewBox="0 0 24 24" fill="white"><path d="M3 3h9a6 6 0 0 1 0 12H3V3z"/><path d="M12 15l6 6" stroke="white" stroke-width="2" fill="none"/></svg>' },
      { url: 'https://notion.so',        label: 'Notion',     bg: '#1a1a1a', svg: '<svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933z"/></svg>' },
      { url: 'https://x.com',            label: 'X',          bg: '#000000', svg: '<svg width="30" height="30" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.629 5.906-5.629zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
      { url: 'https://spotify.com',      label: 'Spotify',    bg: '#1DB954', svg: '<svg width="34" height="34" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>' },
    ]
  }

  _loadPinned() {
    try {
      const saved = JSON.parse(localStorage.getItem('lumen_pinned') || 'null')
      return saved || LumenBrowser._defaultPinned
    } catch { return LumenBrowser._defaultPinned }
  }

  _savePinned(pinned) {
    localStorage.setItem('lumen_pinned', JSON.stringify(pinned))
  }

  _domainColor(domain) {
    const colors = ['#5856D6','#007AFF','#34C759','#FF2D55','#FF9500','#AF52DE','#00C7BE','#FF3B30']
    let hash = 0
    for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash)
    return colors[Math.abs(hash) % colors.length]
  }

  _buildTileEl(site, isPinned) {
    const wrap = document.createElement('div')
    wrap.className = 'ntp-tile'
    wrap.dataset.url = site.url

    const icon = document.createElement('div')
    icon.className = 'ntp-tile-icon'
    icon.style.background = site.bg || '#333'
    if (site.bg === '#000000' || site.bg === '#1a1a1a') {
      icon.style.border = '1px solid rgba(255,255,255,.12)'
    }

    if (site.svg) {
      icon.innerHTML = site.svg
    } else {
      // Large favicon via Google service, fallback to initial letter
      try {
        const domain = new URL(site.url).hostname
        const img = document.createElement('img')
        img.style.cssText = 'width:42px;height:42px;border-radius:10px;object-fit:contain'
        img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
        img.onerror = () => {
          img.remove()
          icon.style.background = this._domainColor(domain)
          icon.innerHTML = `<span style="font-size:26px;font-weight:700;color:white">${domain[0].toUpperCase()}</span>`
        }
        icon.appendChild(img)
      } catch {}
    }

    const label = document.createElement('span')
    label.className = 'ntp-tile-label'
    label.textContent = site.label

    // Pin button
    const pinBtn = document.createElement('button')
    pinBtn.className = 'ntp-tile-pin' + (isPinned ? ' pinned' : '')
    pinBtn.title = isPinned ? 'Desfixar' : 'Fixar nos favoritos'
    // Pin icon SVG
    pinBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'

    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const pinned = this._loadPinned()
      const domainKey = site.url
      const idx = pinned.findIndex(p => p.url === domainKey)
      if (idx !== -1) {
        pinned.splice(idx, 1)
      } else {
        pinned.push(site)
      }
      this._savePinned(pinned)
      this._renderNTPTiles()
    })

    wrap.addEventListener('click', (e) => {
      if (e.target.closest('.ntp-tile-pin')) return
      this.navigate(site.url)
    })

    wrap.appendChild(pinBtn)
    wrap.appendChild(icon)
    wrap.appendChild(label)
    return wrap
  }

  _renderNTPTiles() {
    const container = this.$('ntp-tiles')
    if (!container) return
    container.innerHTML = ''
    const pinned = this._loadPinned()
    pinned.forEach(site => container.appendChild(this._buildTileEl(site, true)))
    this._renderNTPSuggested()
  }

  _renderNTPSuggested() {
    const container = this.$('ntp-suggested-tiles')
    const section = this.$('ntp-section-suggested')
    if (!container || !section) return

    try {
      const visits = JSON.parse(localStorage.getItem('lumen_visits') || '{}')
      const pinned = this._loadPinned()
      const pinnedUrls = new Set(pinned.map(p => p.url))

      const suggested = Object.values(visits)
        .filter(v => !pinnedUrls.has(v.url))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)

      if (suggested.length === 0) {
        section.classList.add('hidden')
        return
      }

      section.classList.remove('hidden')
      container.innerHTML = ''
      suggested.forEach(v => {
        const site = { url: v.url, label: v.title || new URL(v.url).hostname, bg: '#333' }
        container.appendChild(this._buildTileEl(site, false))
      })
    } catch {}
  }

  _resolveURL(input) {
    if (!input) return ''
    const s = input.trim()
    // Already absolute
    if (/^(https?|chrome|about|file):\/\//.test(s)) return s
    // chrome:// internals
    if (s.startsWith('chrome://')) return s
    // Has dot and no space → domain
    if (s.includes('.') && !s.includes(' '))
      return `https://${s}`
    // Search
    const engine = SEARCH_ENGINES[this.prefs.searchEngine] || SEARCH_ENGINES.duckduckgo
    return `${engine}${encodeURIComponent(s)}`
  }

  // ── Audio-Only mode ──────────────────────────────────────────────────────
  _checkVideoSite(tab) {
    if (!tab?.url) { this.audioOnlyBtn.classList.add('hidden'); return }
    const host = (() => { try { return new URL(tab.url).hostname } catch { return '' } })()
    const isVideo = VIDEO_SITES.some(s => host.includes(s))
    tab.isVideoSite = isVideo

    if (isVideo && this.prefs.audioOnlyBtn) {
      this.audioOnlyBtn.classList.remove('hidden')
      this.audioOnlyBtn.classList.toggle('active-btn', tab.audioOnly)
    } else {
      this.audioOnlyBtn.classList.add('hidden')
    }

    if (isVideo && this.prefs.audioOnlyAuto && !tab.audioOnly) {
      this._enableAudioOnly(tab)
    }
  }

  _toggleAudioOnly() {
    const tab = this._activeTab()
    if (!tab?.isVideoSite) return
    tab.audioOnly ? this._disableAudioOnly(tab) : this._enableAudioOnly(tab)
  }

  _enableAudioOnly(tab) {
    tab.audioOnly = true
    this.audioOnlyBtn.classList.add('active-btn')
    this.audioOnlyBtn.title = 'Modo Áudio ativo — clique para restaurar vídeo'
    tab.webviewEl?.executeJavaScript(`
      (function() {
        document.querySelectorAll('video').forEach(v => {
          v._lumenPH = v.style.cssText;
          v.style.cssText = 'position:absolute!important;width:0!important;height:0!important;opacity:0!important;pointer-events:none!important';
        });
        const s = document.createElement('style');
        s.id = '__lumen_ao__';
        s.textContent = 'video{position:absolute!important;width:0!important;height:0!important;opacity:0!important;pointer-events:none!important}';
        document.head.appendChild(s);
        console.log('[Lumen] Modo Áudio-Only ativado');
      })();
    `).catch(() => {})
  }

  _disableAudioOnly(tab) {
    tab.audioOnly = false
    this.audioOnlyBtn.classList.remove('active-btn')
    this.audioOnlyBtn.title = 'Modo Áudio — vídeo pausado, só áudio'
    tab.webviewEl?.executeJavaScript(`
      (function() {
        document.getElementById('__lumen_ao__')?.remove();
        document.querySelectorAll('video').forEach(v => {
          if (v._lumenPH !== undefined) v.style.cssText = v._lumenPH;
        });
        console.log('[Lumen] Modo Áudio-Only desativado');
      })();
    `).catch(() => {})
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  _toggleSettings(force) {
    const open = force !== undefined ? force : !this.isSettingsOpen
    this.isSettingsOpen = open

    if (open) {
      this.ntpEl.classList.remove('active')
      this._activeTab()?.webviewEl?.classList.remove('active')
      this.settingsEl.classList.add('active')
      this.addrInput.value = 'lumen://settings'
      this.$('security-icon').style.display = 'none'
    } else {
      this.settingsEl.classList.remove('active')
      const tab = this._activeTab()
      if (tab?.webviewEl) tab.webviewEl.classList.add('active')
      else this.ntpEl.classList.add('active')
      this._syncAddressBar()
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _getTab(id) { return this.tabs.find(t => t.id === id) }
  _activeTab() { return this._getTab(this.activeId) }
  _activeWV() { return this._activeTab()?.webviewEl }

  _syncAddressBar() {
    const tab = this._activeTab()
    const url = this.isSettingsOpen ? 'lumen://settings' : (tab?.url || '')
    this.addrInput.value = url
    const si = this.$('security-icon')
    const isHttps = url.startsWith('https://')
    si.style.display = isHttps ? '' : 'none'
    si.title = 'Conexão segura'
  }

  _updateNavBtns() {
    const wv = this._activeWV()
    this.backBtn.disabled = !wv?.canGoBack()
    this.forwardBtn.disabled = !wv?.canGoForward()
  }

  _initLanguage() {
    // Apply saved language on load
    applyTranslations()

    // Wire language buttons in settings
    document.querySelectorAll('.lang-btn').forEach(btn => {
      const lang = btn.dataset.lang
      if (lang === (localStorage.getItem('lumen-lang') || 'pt')) {
        btn.classList.add('active')
      } else {
        btn.classList.remove('active')
      }
      btn.addEventListener('click', () => {
        localStorage.setItem('lumen-lang', lang)
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang))
        applyTranslations()
      })
    })
  }

  _initBookmarks() {
    this._renderBookmarksBar()
    this.$('bm-add-btn')?.addEventListener('click', () => this._addCurrentPageBookmark())
  }

  _loadBookmarks() {
    try { return JSON.parse(localStorage.getItem('lumen_bookmarks') || '[]') } catch { return [] }
  }

  _saveBookmarks(bms) {
    localStorage.setItem('lumen_bookmarks', JSON.stringify(bms))
  }

  _renderBookmarksBar() {
    const container = this.$('bm-items')
    if (!container) return
    const bms = this._loadBookmarks()
    container.innerHTML = ''
    bms.forEach((bm, i) => {
      const btn = document.createElement('button')
      btn.className = 'bm-btn'
      btn.title = bm.url

      try {
        const img = document.createElement('img')
        img.src = `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=32`
        img.onerror = () => img.remove()
        btn.appendChild(img)
      } catch {}

      const label = document.createElement('span')
      label.className = 'bm-btn-label'
      label.textContent = bm.label || bm.url
      btn.appendChild(label)

      btn.addEventListener('click', (e) => {
        if (e.button === 0) this.navigate(bm.url)
      })
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this._showBmCtxMenu(e.clientX, e.clientY, i)
      })
      container.appendChild(btn)
    })

    const bmBar = this.$('bm-bar')
    if (bmBar) bmBar.classList.toggle('hidden', !this.prefs.bookmarksBar)
  }

  _addCurrentPageBookmark() {
    const tab = this._activeTab()
    if (!tab?.url || tab.url.startsWith('lumen://')) return
    const bms = this._loadBookmarks()
    if (bms.some(b => b.url === tab.url)) { this._showToast('Já está nos favoritos', 'info'); return }
    bms.push({ url: tab.url, label: tab.title || new URL(tab.url).hostname })
    this._saveBookmarks(bms)
    this._renderBookmarksBar()
    this._showToast('Adicionado aos favoritos', 'success')
  }

  _showBmCtxMenu(x, y, idx) {
    const existing = document.querySelector('#bm-ctx')
    existing?.remove()
    const menu = document.createElement('div')
    menu.id = 'bm-ctx'
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--panel-bg);border:1px solid var(--border);border-radius:10px;padding:4px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.2);min-width:150px`

    const rmItem = document.createElement('button')
    rmItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:transparent;color:var(--text-1);cursor:pointer;border-radius:7px;font-size:13px'
    rmItem.textContent = 'Remover favorito'
    rmItem.onmouseenter = () => rmItem.style.background = 'var(--card-bg)'
    rmItem.onmouseleave = () => rmItem.style.background = 'transparent'
    rmItem.addEventListener('click', () => {
      const bms = this._loadBookmarks()
      bms.splice(idx, 1)
      this._saveBookmarks(bms)
      this._renderBookmarksBar()
      menu.remove()
    })
    menu.appendChild(rmItem)
    document.body.appendChild(menu)

    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close) } }
    setTimeout(() => document.addEventListener('mousedown', close), 10)
  }

  async _initAboutSection() {
    // Show app version in about section
    const ver = await window.lumen?.getVersion?.()
    const verEl = this.$('about-version')
    if (verEl && ver) verEl.textContent = `v${ver} – Prealpha (Electron)`

    // Wire external links in about section
    document.querySelectorAll('.about-link[data-url]').forEach(a => {
      a.addEventListener('click', () => {
        const url = a.dataset.url
        if (url) window.lumen?.openExternal?.(url)
      })
    })
  }

  _initUpdater() {
    this._initAboutSection()
    window.lumen?.onUpdateReady?.(() => {
      const toast = document.createElement('div')
      toast.id = 'update-toast'
      toast.innerHTML = `
        <span>${t('update.ready')}</span>
        <button id="update-now-btn">${t('update.install')}</button>
        <button id="update-dismiss-btn">${t('setup.skip')}</button>
      `
      document.body.appendChild(toast)
      this.$('update-now-btn')?.addEventListener('click', () => window.lumen?.installUpdate?.())
      this.$('update-dismiss-btn')?.addEventListener('click', () => toast.remove())
      setTimeout(() => { if (toast.isConnected) toast.remove() }, 15000)
    })

    window.lumen?.onExtInstalled?.((ext) => {
      this._showToast(`Extensão instalada: ${ext.name}`, 'success')
      this._refreshLoadedExtensions()
    })

    window.lumen?.onExtInstallError?.((msg) => {
      this._showToast(`Erro ao instalar extensão: ${msg}`, 'error')
    })
  }

  _showToast(message, type = 'info') {
    const existing = document.getElementById('lumen-toast')
    existing?.remove()
    const toast = document.createElement('div')
    toast.id = 'lumen-toast'
    toast.className = `lumen-toast lumen-toast-${type}`
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 4000)
  }

  _initPlatform() {
    window.lumen?.getPlatform?.().then(platform => this._applyPlatform(platform))
    window.lumen?.onPlatform?.(p => this._applyPlatform(p))
    window.lumen?.onWinMaximized?.(maximized => {
      const btn = this.$('win-max')
      if (!btn) return
      btn.title = maximized ? 'Restaurar' : 'Maximizar'
      btn.querySelector('svg').innerHTML = maximized
        ? '<path d="M1 4h6v6M4 1h5v5" stroke="currentColor" stroke-width="1" stroke-linecap="round" fill="none"/>'
        : '<rect x=".5" y=".5" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none"/>'
    })
    this.$('win-min')?.addEventListener('click', () => window.lumen?.winMinimize?.())
    this.$('win-max')?.addEventListener('click', () => window.lumen?.winMaximize?.())
    this.$('win-close')?.addEventListener('click', () => window.lumen?.winClose?.())
  }

  _applyPlatform(platform) {
    if (!platform) return
    document.body.classList.add(platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'macos')
    if (platform !== 'darwin') {
      this.$('win-controls')?.classList.remove('hidden')
    }
  }

  _closeAllPanels() {
    this.privacyPanel?.classList.remove('visible')
    this.$('ext-panel')?.classList.add('hidden')
    this.$('ntp-edit-panel')?.classList.add('hidden')
  }

  _applyNtpBg(value) {
    const ntp = this.$('ntp')
    if (!ntp) return
    if (!value) {
      ntp.style.backgroundImage = ''
      ntp.style.backgroundSize = ''
    } else if (value.startsWith('url(')) {
      ntp.style.backgroundImage = value
      ntp.style.backgroundSize = 'cover'
      ntp.style.backgroundPosition = 'center'
    } else {
      ntp.style.background = value
    }
  }

  // ── Context Menu ──────────────────────────────────────────────────────────
  _initContextMenu() {
    const menu = this.$('ctx-menu')
    if (!menu) return
    document.addEventListener('click', () => menu.classList.add('hidden'))
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.classList.add('hidden') })
    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation()
        const wv = this._activeWV()
        const url = this._ctxURL
        const text = this._ctxText
        switch (item.dataset.action) {
          case 'back':    wv?.goBack(); break
          case 'forward': wv?.goForward(); break
          case 'reload':  wv?.reload(); break
          case 'open-link': if (url) this.createTab({ url }); break
          case 'copy-link': if (url) navigator.clipboard.writeText(url); break
          case 'copy-text': if (text) navigator.clipboard.writeText(text); break
          case 'search-text': if (text) this.createTab({ url: `https://duckduckgo.com/?q=${encodeURIComponent(text)}` }); break
          case 'save-page': wv?.getWebContents?.()?.savePage?.(); break
          case 'view-source': if (this._activeTab()?.url) this.createTab({ url: 'view-source:' + this._activeTab().url }); break
        }
        menu.classList.add('hidden')
      })
    })
  }

  _showContextMenu(x, y, { linkURL, selectionText } = {}) {
    const menu = this.$('ctx-menu')
    if (!menu) return
    this._ctxURL = linkURL || ''
    this._ctxText = selectionText || ''
    const hasLink = !!linkURL
    const hasText = !!selectionText

    menu.querySelectorAll('.ctx-link-group').forEach(el => el.style.display = hasLink ? '' : 'none')
    menu.querySelectorAll('.ctx-text-group').forEach(el => el.style.display = hasText ? '' : 'none')

    menu.classList.remove('hidden')
    const vw = window.innerWidth, vh = window.innerHeight
    const w = menu.offsetWidth || 200, h = menu.offsetHeight || 180
    menu.style.left = (x + w > vw ? x - w : x) + 'px'
    menu.style.top  = (y + h > vh ? y - h : y) + 'px'
  }

  _addLoadedExtensionToPanel(ext, container) {
    const list = container || this.$('ext-loaded-list')
    if (!list) return
    const existing = list.querySelector(`[data-extid="${ext.id}"]`)
    if (existing) return
    const div = document.createElement('div')
    div.className = 'ext-item'
    div.dataset.extid = ext.id
    div.innerHTML = `
      <div class="ext-icon" style="background:linear-gradient(135deg,#1a1a2e,#16213e)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7857FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>
      </div>
      <div class="ext-info">
        <div class="ext-name">${ext.name}</div>
        <div class="ext-desc">${ext.description?.slice(0, 60) || 'v' + ext.version}</div>
      </div>
      <div class="ext-toggle active" data-extid="${ext.id}"></div>
    `
    div.querySelector('.ext-toggle').addEventListener('click', async (e) => {
      const t = e.currentTarget
      if (t.classList.contains('active')) {
        await window.lumen?.removeExtension?.(ext.id)
        t.classList.remove('active')
      } else {
        t.classList.add('active')
      }
    })
    list.appendChild(div)
  }

  _refreshLoadedExtensions() {
    window.lumen?.getExtensions?.().then(exts => {
      const list = this.$('ext-loaded-list')
      if (!list) return
      list.innerHTML = ''
      exts?.forEach(e => this._addLoadedExtensionToPanel(e, list))
    })
  }

  _zoom(dir) {
    const tab = this._activeTab()
    if (!tab?.webviewEl) return
    const current = tab.zoomFactor || 1
    if (dir === 0) { tab.zoomFactor = 1; tab.webviewEl.setZoomFactor(1); return }
    const next = Math.min(3, Math.max(0.25, current + dir * 0.1))
    tab.zoomFactor = next
    tab.webviewEl.setZoomFactor(next)
  }

  _openFind() {
    const bar = this.$('find-bar')
    if (!bar) return
    bar.classList.remove('hidden')
    const input = this.$('find-input')
    input?.focus()
    input?.select()
  }

  _closeFind() {
    const bar = this.$('find-bar')
    bar?.classList.add('hidden')
    this._activeWV()?.stopFindInPage('clearSelection')
    this.$('find-status').textContent = ''
  }

  _doFind() {
    const query = this.$('find-input')?.value
    if (!query) { this._activeWV()?.stopFindInPage('clearSelection'); this.$('find-status').textContent = ''; return }
    this._activeWV()?.findInPage(query)
  }

  _findStep(dir) {
    const bar = this.$('find-bar')
    if (bar?.classList.contains('hidden')) { this._openFind(); return }
    const query = this.$('find-input')?.value
    if (!query) return
    this._activeWV()?.findInPage(query, { forward: dir > 0, findNext: true })
  }

  _pinCurrentTab() {
    const tab = this._activeTab()
    if (!tab?.url) return
    try {
      const u = new URL(tab.url)
      const domain = u.hostname.replace(/^www\./, '')
      const pinned = this._loadPinned()
      const exists = pinned.some(p => p.url === tab.url)
      if (!exists) {
        const site = { url: tab.url, label: tab.title || domain, bg: '#333' }
        pinned.push(site)
        this._savePinned(pinned)
        this._renderNTPTiles()
        this._showToast(`"${site.label}" fixado nos favoritos`, 'success')
      }
    } catch {}
  }

  _setLoading(on) {
    this.progressBar.classList.toggle('loading', on)
    this.refreshBtn.classList.toggle('is-loading', on)
  }

  _switchTab(dir) {
    if (this.tabs.length < 2) return
    const idx = this.tabs.findIndex(t => t.id === this.activeId)
    const next = this.tabs[(idx + dir + this.tabs.length) % this.tabs.length]
    this._activateTab(next.id)
  }

  _updateGreeting() {
    this._tickClock()
    setInterval(() => this._tickClock(), 10000)
  }

  _greetingText() {
    const h = new Date().getHours()
    const lang = localStorage.getItem('lumen-lang') || 'pt'
    const greetings = {
      pt: h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite',
      en: h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening',
      de: h < 12 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend',
    }
    return greetings[lang] || greetings.pt
  }

  _clockLocale() {
    const lang = localStorage.getItem('lumen-lang') || 'pt'
    return lang === 'de' ? 'de-DE' : lang === 'en' ? 'en-US' : 'pt-BR'
  }

  _tickClock() {
    const now = new Date()
    const locale = this._clockLocale()
    const timeEl = document.getElementById('ntp-time')
    const dateEl = document.getElementById('ntp-date')
    const greetEl = document.getElementById('ntp-greeting')
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    }
    if (greetEl) {
      greetEl.textContent = this._greetingText()
    }
  }

  // ── Apply saved prefs to UI ───────────────────────────────────────────────
  _applyPrefs() {
    document.documentElement.style.setProperty('--accent', this.prefs.accent)

    // Toggles
    const prefMap = {
      'pref-adblock':          'adblock',
      'pref-trackers':         'trackers',
      'pref-fingerprint':      'fingerprint',
      'pref-https':            'https',
      'pref-3p-cookies':       '3p-cookies',
      'pref-webrtc':           'webrtc',
      'pref-memory-saver':     'memorySaver',
      'pref-bg-throttle':      'bgThrottle',
      'pref-preload':          'preload',
      'pref-audio-only-auto':  'audioOnlyAuto',
      'pref-audio-only-btn':   'audioOnlyBtn',
      'pref-gpu':              'gpu',
      'pref-smooth':           'smooth',
      'pref-suggestions':      'suggestions',
      'pref-selection-search': 'selectionSearch',
      'pref-apple-passwords':  'applePasswords',
      'pref-autofill':         'autofill',
      'pref-save-passwords':   'savePasswords',
      'pref-breach-alerts':    'breachAlerts',
      'pref-biometric':        'biometric',
      'pref-vpn-incognito':    'vpnIncognito',
      'pref-vpn-always':       'vpnAlways',
      'pref-devtools':         'devtools',
      'pref-verbose':          'verbose',
      'pref-clear-on-close':   'clearOnClose',
      'pref-bookmarks-bar':    'bookmarksBar',
      'pref-animations':       'animations',
    }

    for (const [elId, key] of Object.entries(prefMap)) {
      const el = this.$(elId)
      if (el) el.classList.toggle('active', !!this.prefs[key])
    }

    // Search engine
    document.querySelectorAll('.search-engine-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.engine === this.prefs.searchEngine)
    })

    // Privacy level
    document.querySelectorAll('.privacy-level').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.level === this.prefs.privacyLevel)
    })

    // VPN location
    document.querySelectorAll('.vpn-loc').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.loc === this.prefs.vpnLocation)
    })
    this.vpnLocEl.textContent = this.prefs.vpnLocation

    // Accent dots
    document.querySelectorAll('.accent-dot').forEach(dot => {
      dot.classList.toggle('active', dot.dataset.color === this.prefs.accent)
    })

    // Theme select
    const themeEl = this.$('pref-theme')
    if (themeEl) themeEl.value = this.prefs.theme

    // Bookmarks bar visibility
    const bmBar = this.$('bm-bar')
    if (bmBar) bmBar.classList.toggle('hidden', !this.prefs.bookmarksBar)

    this._applyTheme()
    this._applyFontSize()
  }

  _applyTheme() {
    const t = this.prefs.theme
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
    else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }

  _applyFontSize() {
    const sizes = { small: '13px', medium: '15px', large: '17px', xlarge: '19px' }
    const sz = sizes[this.prefs.fontSize || 'medium'] || '15px'
    document.documentElement.style.setProperty('--ui-font-size', sz)
    const el = this.$('pref-font-size')
    if (el) el.value = this.prefs.fontSize || 'medium'
  }
}

// ─── Sidebar ───────────────────────────────────────────────────────────────
// States: 'hidden' | 'rail' | 'open'
class LumenSidebar {
  constructor() {
    this.sidebarEl   = document.getElementById('sidebar')
    this.panelEl     = document.getElementById('sidebar-panel')
    this.titleEl     = document.getElementById('sidebar-panel-title')
    this.addModal    = document.getElementById('sbar-add-modal')
    this.urlInput    = document.getElementById('sbar-url-input')
    this.nameInput   = document.getElementById('sbar-name-input')
    this.activeApp   = null
    this.state       = 'rail'  // 'hidden' | 'rail' | 'open'
    this.customCount = 0
    this.hiddenBuiltins = new Set(
      JSON.parse(localStorage.getItem('lumen_hidden_builtins') || '[]')
    )

    this._applyHiddenBuiltins()
    this._enhanceRailBtns()
    this._bind()
    this._loadCustomApps()
    this.setState('rail')
  }

  // ── State machine ────────────────────────────────────────────────────────
  setState(s) {
    this.state = s
    this.sidebarEl.classList.remove('sb-hidden', 'rail-only', 'open')
    if (s === 'hidden') this.sidebarEl.classList.add('sb-hidden')
    if (s === 'rail')   this.sidebarEl.classList.add('rail-only')
    if (s === 'open')   this.sidebarEl.classList.add('open')
    if (s !== 'open') {
      document.querySelectorAll('.sbar-btn[data-app]').forEach(b => b.classList.remove('active'))
      this.activeApp = null
    }
  }

  // toggle (⌘B / toolbar btn): cycles hidden ↔ rail; if open → rail
  toggle() {
    if (this.state === 'open')   this.setState('rail')
    else if (this.state === 'rail') this.setState('hidden')
    else                          this.setState('rail')
  }

  _bind() {
    document.querySelectorAll('.sbar-btn[data-app]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.sbar-remove')) return
        this._activate(btn.dataset.app, btn)
      })
    })

    document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => this.toggle())

    document.getElementById('sbar-close-btn')?.addEventListener('click', () => this.setState('rail'))
    document.getElementById('sbar-pop-btn')?.addEventListener('click', () => {
      const wv = document.querySelector('.sbwv.active')
      if (wv?.src) window.browser?.createTab({ url: wv.src })
    })

    document.getElementById('sbar-add-btn')?.addEventListener('click', () => {
      this.addModal.classList.remove('hidden')
      this.urlInput.value = ''
      this.nameInput.value = ''
      setTimeout(() => this.urlInput.focus(), 60)
    })
    document.getElementById('sbar-modal-cancel')?.addEventListener('click', () =>
      this.addModal.classList.add('hidden'))
    document.getElementById('sbar-modal-add')?.addEventListener('click', () => this._addCustom())
    this.addModal?.addEventListener('click', (e) => {
      if (e.target === this.addModal) this.addModal.classList.add('hidden')
    })
    this.urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._addCustom()
      if (e.key === 'Escape') this.addModal.classList.add('hidden')
    })

    // Panel title: click to rename
    this.titleEl?.addEventListener('dblclick', () => this._renameActive())

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  _activate(appId, btnEl) {
    // Clicking same app while open → collapse to rail
    if (this.activeApp === appId && this.state === 'open') {
      this.setState('rail')
      return
    }

    this.activeApp = appId
    document.querySelectorAll('.sbar-btn[data-app]').forEach(b => b.classList.remove('active'))
    btnEl?.classList.add('active')

    document.querySelectorAll('.sbwv').forEach(wv => wv.classList.remove('active'))
    document.getElementById(`sbwv-${appId}`)?.classList.add('active')

    const names = {
      whatsapp: 'WhatsApp', music: 'Apple Music', telegram: 'Telegram',
      instagram: 'Instagram', twitter: 'X / Twitter', calendar: 'Calendário', spotify: 'Spotify',
    }
    this.titleEl.textContent =
      names[appId] || document.querySelector(`.sbar-btn[data-app="${appId}"]`)?.title || appId

    this.setState('open')
  }

  // ── Remove / rename ──────────────────────────────────────────────────────
  _enhanceRailBtns() {
    document.querySelectorAll('.sbar-btn[data-app]').forEach(btn => this._addRemoveBtn(btn))
  }

  _addRemoveBtn(btn) {
    const x = document.createElement('span')
    x.className = 'sbar-remove'
    x.title = 'Remover da sidebar'
    x.innerHTML = `<svg width="9" height="9" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
    x.addEventListener('click', (e) => {
      e.stopPropagation()
      this._removeApp(btn)
    })
    btn.appendChild(x)
  }

  _removeApp(btn) {
    const id = btn.dataset.app
    const isCustom = id.startsWith('custom-')

    if (isCustom) {
      document.getElementById(`sbwv-${id}`)?.remove()
      btn.remove()
      this._saveCustomApps()
    } else {
      // Built-in: just hide from rail + remember
      btn.style.display = 'none'
      this.hiddenBuiltins.add(id)
      localStorage.setItem('lumen_hidden_builtins', JSON.stringify([...this.hiddenBuiltins]))
    }

    if (this.activeApp === id) this.setState('rail')
  }

  _applyHiddenBuiltins() {
    this.hiddenBuiltins.forEach(id => {
      const btn = document.querySelector(`.sbar-btn[data-app="${id}"]`)
      if (btn) btn.style.display = 'none'
    })
  }

  _renameActive() {
    if (!this.activeApp) return
    const btn = document.querySelector(`.sbar-btn[data-app="${this.activeApp}"]`)
    const current = this.titleEl.textContent
    const name = prompt('Renomear:', current)
    if (name?.trim()) {
      this.titleEl.textContent = name.trim()
      if (btn) btn.title = name.trim()
      this._saveCustomApps()
    }
  }

  _addCustom() {
    let url = this.urlInput.value.trim()
    const name = this.nameInput.value.trim() || url
    if (!url) return
    if (!url.startsWith('http')) url = `https://${url}`

    const id = `custom-${++this.customCount}`

    // Create webview
    const wv = document.createElement('webview')
    wv.id = `sbwv-${id}`
    wv.className = 'sbwv'
    wv.src = url
    this.panelEl.appendChild(wv)

    // Create rail button
    const btn = this._makeCustomBtn(id, name, url)
    const addBtn = document.getElementById('sbar-add-btn')
    addBtn?.parentElement?.insertBefore(btn, addBtn)

    this._saveCustomApps()
    this.addModal.classList.add('hidden')
    this._activate(id, btn)
  }

  _makeCustomBtn(id, name, url) {
    const initial = name[0]?.toUpperCase() || '?'
    const btn = document.createElement('button')
    btn.className = 'sbar-btn'
    btn.dataset.app = id
    btn.title = name
    btn.innerHTML = `<span class="sbar-initial">${initial}</span>`
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.sbar-remove')) return
      this._activate(id, btn)
    })
    this._addRemoveBtn(btn)
    return btn
  }

  _saveCustomApps() {
    const customs = []
    document.querySelectorAll('.sbar-btn[data-app^="custom-"]').forEach(btn => {
      const wv = document.getElementById(`sbwv-${btn.dataset.app}`)
      if (wv) customs.push({ id: btn.dataset.app, url: wv.src, name: btn.title })
    })
    localStorage.setItem('lumen_sidebar_apps', JSON.stringify(customs))
  }

  _loadCustomApps() {
    try {
      const customs = JSON.parse(localStorage.getItem('lumen_sidebar_apps') || '[]')
      customs.forEach(app => {
        const wv = document.createElement('webview')
        wv.id = `sbwv-${app.id}`
        wv.className = 'sbwv'
        wv.src = app.url
        this.panelEl.appendChild(wv)

        const btn = this._makeCustomBtn(app.id, app.name, app.url)
        const addBtn = document.getElementById('sbar-add-btn')
        addBtn?.parentElement?.insertBefore(btn, addBtn)

        const num = parseInt(app.id.split('-')[1] || '0')
        if (num > this.customCount) this.customCount = num
      })
    } catch {}
  }
}

// ─── Setup Wizard ──────────────────────────────────────────────────────────
class LumenSetup {
  constructor() {
    this.wizard   = document.getElementById('setup-wizard')
    this.dots     = document.querySelectorAll('.setup-dot')
    this.steps    = document.querySelectorAll('.setup-step')
    this.current  = 1
    this.choices  = { theme: 'dark', engine: 'duckduckgo', privacy: 'aggressive', pwd: 'apple' }

    // Apply dark immediately so wizard itself looks right
    document.documentElement.setAttribute('data-theme', 'dark')

    if (localStorage.getItem('lumen_setup_done')) {
      this._dismiss(false)
      return
    }

    this._bind()
  }

  _bind() {
    // Next buttons
    document.querySelectorAll('.sw-btn-next[data-next]').forEach(btn => {
      btn.addEventListener('click', () => this._goTo(parseInt(btn.dataset.next)))
    })
    // Back buttons
    document.querySelectorAll('.sw-btn-back[data-back]').forEach(btn => {
      btn.addEventListener('click', () => this._goTo(parseInt(btn.dataset.back), true))
    })

    // Theme choices
    document.querySelectorAll('.sw-choice[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sw-choice').forEach(b => b.classList.remove('selected'))
        btn.classList.add('selected')
        this.choices.theme = btn.dataset.theme
        // Preview immediately
        const t = btn.dataset.theme
        if (t === 'system') document.documentElement.removeAttribute('data-theme')
        else document.documentElement.setAttribute('data-theme', t)
      })
    })

    // Engine choices
    document.querySelectorAll('.sw-engine[data-engine]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sw-engine').forEach(b => b.classList.remove('selected'))
        btn.classList.add('selected')
        this.choices.engine = btn.dataset.engine
      })
    })

    // Privacy choices
    document.querySelectorAll('.sw-privacy[data-level]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sw-privacy').forEach(b => b.classList.remove('selected'))
        btn.classList.add('selected')
        this.choices.privacy = btn.dataset.level
      })
    })

    // Password choices
    document.querySelectorAll('.sw-pwd[data-pwd]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sw-pwd').forEach(b => b.classList.remove('selected'))
        btn.classList.add('selected')
        this.choices.pwd = btn.dataset.pwd
      })
    })

    // Finish
    document.getElementById('sw-finish')?.addEventListener('click', () => this._finish())
  }

  _goTo(n, back = false) {
    const prev = this.wizard.querySelector(`.setup-step[data-step="${this.current}"]`)
    const next = this.wizard.querySelector(`.setup-step[data-step="${n}"]`)
    if (!next) return

    prev?.classList.remove('active')
    next.classList.remove('back')
    if (back) next.classList.add('back')
    next.classList.add('active')

    this.current = n
    this._updateDots()
    if (n === 6) this._fillSummary()
  }

  _updateDots() {
    this.dots.forEach((dot, i) => {
      dot.classList.remove('active', 'done-dot')
      if (i + 1 === this.current) dot.classList.add('active')
      else if (i + 1 < this.current) dot.classList.add('done-dot')
    })
  }

  _fillSummary() {
    const themeNames  = { system: 'Sistema', dark: 'Escuro', light: 'Claro' }
    const engineNames = { duckduckgo: 'DuckDuckGo', brave: 'Brave Search', startpage: 'Startpage', google: 'Google' }
    const privNames   = { standard: 'Padrão', aggressive: 'Agressivo', nuclear: 'Nuclear' }
    const pwdNames    = { apple: 'Apple Senhas', google: 'Google Senhas', mind: 'Minha mente' }

    document.getElementById('sw-sum-theme').textContent   = themeNames[this.choices.theme]   || this.choices.theme
    document.getElementById('sw-sum-engine').textContent  = engineNames[this.choices.engine]  || this.choices.engine
    document.getElementById('sw-sum-privacy').textContent = privNames[this.choices.privacy]   || this.choices.privacy
    document.getElementById('sw-sum-pwd').textContent     = pwdNames[this.choices.pwd]        || this.choices.pwd
  }

  _finish() {
    // Apply choices to prefs
    const prefs = loadPrefs()
    prefs.theme         = this.choices.theme
    prefs.searchEngine  = this.choices.engine
    prefs.privacyLevel  = this.choices.privacy
    savePrefs(prefs)

    // Apply theme immediately
    if (this.choices.theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', this.choices.theme)

    localStorage.setItem('lumen_setup_done', '1')
    this._dismiss(true)
  }

  _dismiss(animate) {
    if (animate) {
      this.wizard.classList.add('done')
      setTimeout(() => { this.wizard.style.display = 'none' }, 420)
    } else {
      this.wizard.style.display = 'none'
    }
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.setup   = new LumenSetup()
  window.browser = new LumenBrowser()
  window.sidebar = new LumenSidebar()
})
