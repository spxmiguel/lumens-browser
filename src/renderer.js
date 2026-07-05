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
    this._initDownloads()
    this._initHistory()
    this._initSplitView()
    this._initNTPQuickActions()
    this._initDataExport()
    this._initCommandPalette()
    this._initAIPanel()
    this._initPermissions()
    this._initNotes()
    this._initWeather()
    this._initTabDeck()

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

    // Trackpad horizontal swipe on webview area: back/forward
    let swipeAcc = 0; let swipeTimer = null
    this.webviewArea?.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return
      swipeAcc += e.deltaX
      clearTimeout(swipeTimer)
      swipeTimer = setTimeout(() => {
        if (swipeAcc > 80 && this._activeWV()?.canGoForward()) this._activeWV().goForward()
        else if (swipeAcc < -80 && this._activeWV()?.canGoBack()) this._activeWV().goBack()
        swipeAcc = 0
      }, 80)
    }, { passive: true })
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

    this.$('security-icon')?.addEventListener('click', () => {
      const url = this._activeTab()?.url || ''
      if (!url || url.startsWith('lumen://')) return
      navigator.clipboard.writeText(url).then(() => this._showToast('URL copiada', 'success', 2000))
    })

    this.$('privacy-badge').addEventListener('click', () => {
      const open = !this.privacyPanel.classList.contains('visible')
      this._closeAllPanels()
      if (open) this.privacyPanel.classList.add('visible')
    })
    this.$('close-pp').addEventListener('click', () => this.privacyPanel.classList.remove('visible'))

    this.$('settings-btn').addEventListener('click', () => this._toggleSettings())
    this.$('history-btn')?.addEventListener('click', () => this._openHistory())

    this.audioOnlyBtn.addEventListener('click', () => this._toggleAudioOnly())

    // Settings navigation
    document.querySelectorAll('.settings-nav').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.settings-nav').forEach(b => b.classList.remove('active'))
        document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'))
        btn.classList.add('active')
        this.$(`section-${btn.dataset.section}`)?.classList.add('active')
        if (btn.dataset.section === 'permissions') this._renderPermissionsList()
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
        if (!dot.dataset.color) return
        document.querySelectorAll('.accent-dot').forEach(d => d.classList.remove('active'))
        dot.classList.add('active')
        this.prefs.accent = dot.dataset.color
        savePrefs(this.prefs)
        document.documentElement.style.setProperty('--accent', dot.dataset.color)
      })
    })

    this.$('accent-custom-input')?.addEventListener('input', (e) => {
      const color = e.target.value
      document.querySelectorAll('.accent-dot').forEach(d => d.classList.remove('active'))
      const label = e.target.closest('.accent-dot')
      label?.classList.add('active')
      label.style.background = color
      this.prefs.accent = color
      savePrefs(this.prefs)
      document.documentElement.style.setProperty('--accent', color)
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
    // Non-modifier shortcuts (F12)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12') {
        e.preventDefault()
        const wv = this._activeWV()
        if (wv) wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools()
      }
    })

    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 't' && e.shiftKey) { e.preventDefault(); this._reopenLastTab(); return }
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
      if (e.key === 'p' && e.shiftKey) { e.preventDefault(); this._togglePiP() }
      if (e.key === 'u') { e.preventDefault(); this._toggleReadingMode() }
      if (e.key === 'h') { e.preventDefault(); this._openHistory() }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); this._toggleShortcutsHelp() }
      if (e.key === 'e' && e.shiftKey) { e.preventDefault(); this.splitActive ? this._closeSplitView() : this._openSplitView() }
      if (e.key === 'i' && e.shiftKey) {
        e.preventDefault()
        const wv = this._activeWV()
        if (wv) wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools()
      }
      if (e.key === 'k' && e.shiftKey) { e.preventDefault(); this._toggleFocusMode() }
      if (e.key === 'k' && !e.shiftKey) { e.preventDefault(); this._openCommandPalette() }
      if (e.key === 'a' && e.shiftKey) { e.preventDefault(); this._toggleAIPanel() }
      if (e.key === 'n' && e.shiftKey && !e.ctrlKey) { e.preventDefault(); this._toggleNotes() }
      if (e.key === 's' && e.shiftKey) { e.preventDefault(); this._captureScreenshot() }
      if (e.key === 'd' && e.shiftKey) { e.preventDefault(); this._openTabDeck() }
      // Cmd+1-9: jump to tab by position
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        e.preventDefault()
        const ids = this.tabs.map(t => t.id).filter(id => !this.tabs.find(t => t.id === id)?.pinned).concat(
          this.tabs.filter(t => t.pinned).map(t => t.id)
        )
        const allIds = this.tabs.map(t => t.id)
        const target = allIds[num - 1]
        if (target) this.switchTab(target)
      }
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

    // Save to recently closed (max 15)
    if (tab.url && !tab.url.startsWith('lumen://')) {
      if (!this.closedTabs) this.closedTabs = []
      this.closedTabs.unshift({ url: tab.url, title: tab.title || tab.url })
      if (this.closedTabs.length > 15) this.closedTabs.pop()
    }

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

  _reopenLastTab() {
    if (!this.closedTabs?.length) {
      this._showToast('Nenhuma aba fechada recentemente', 'info', 2000)
      return
    }
    const { url } = this.closedTabs.shift()
    this.createTab({ url })
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
    this._updateZoomIndicator(tab)
    // Refresh notes panel if open
    if (!this.$('notes-panel')?.classList.contains('hidden')) this._loadNoteForCurrentPage()
  }

  _buildTabEl(tab) {
    const el = document.createElement('div')
    el.className = `tab${tab.incognito ? ' incognito' : ''}`
    el.dataset.tabId = tab.id
    el.setAttribute('role', 'tab')
    el.innerHTML = `
      <span class="tab-fav"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg></span>
      <span class="tab-title">${tab.incognito ? 'Incógnito' : 'Nova Aba'}</span>
      <button class="tab-mute hidden" title="Silenciar/Ativar áudio">
        <svg class="tab-mute-on" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        <svg class="tab-mute-off hidden" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
      </button>
      <button class="tab-x" title="Fechar">
        <svg width="11" height="11" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>`

    el.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-x') && !e.target.closest('.tab-mute')) this._activateTab(tab.id)
    })

    // Drag-and-drop reordering
    el.draggable = true
    el.addEventListener('dragstart', (e) => {
      this._dragTabId = tab.id
      el.classList.add('tab-dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    el.addEventListener('dragend', () => {
      el.classList.remove('tab-dragging')
      document.querySelectorAll('.tab-drag-over').forEach(t => t.classList.remove('tab-drag-over'))
      this._dragTabId = null
    })
    el.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (this._dragTabId === tab.id) return
      document.querySelectorAll('.tab-drag-over').forEach(t => t.classList.remove('tab-drag-over'))
      el.classList.add('tab-drag-over')
    })
    el.addEventListener('drop', (e) => {
      e.preventDefault()
      el.classList.remove('tab-drag-over')
      if (!this._dragTabId || this._dragTabId === tab.id) return
      const fromIdx = this.tabs.findIndex(t => t.id === this._dragTabId)
      const toIdx = this.tabs.findIndex(t => t.id === tab.id)
      if (fromIdx === -1 || toIdx === -1) return
      const [moved] = this.tabs.splice(fromIdx, 1)
      this.tabs.splice(toIdx, 0, moved)
      // Reorder DOM
      const tabsEl = this.tabsEl
      const movingEl = moved.tabEl
      const targetEl = tab.tabEl
      if (fromIdx < toIdx) tabsEl.insertBefore(movingEl, targetEl.nextSibling)
      else tabsEl.insertBefore(movingEl, targetEl)
    })

    // Tab preview on hover
    let previewTimer
    el.addEventListener('mouseenter', () => {
      if (tab.id === this.activeId) return
      previewTimer = setTimeout(() => this._showTabPreview(el, tab), 400)
    })
    el.addEventListener('mouseleave', () => {
      clearTimeout(previewTimer)
      this._hideTabPreview()
    })

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this._showTabContextMenu(e.clientX, e.clientY, tab)
    })
    el.querySelector('.tab-x').addEventListener('click', (e) => {
      e.stopPropagation()
      this.closeTab(tab.id)
    })
    el.querySelector('.tab-mute').addEventListener('click', (e) => {
      e.stopPropagation()
      this._toggleTabMute(tab)
    })
    return el
  }

  _showTabPreview(el, tab) {
    this._hideTabPreview()
    const preview = document.createElement('div')
    preview.id = 'tab-preview'
    preview.style.cssText = `position:fixed;z-index:99990;pointer-events:none;`

    const rect = el.getBoundingClientRect()
    const title = tab.title || tab.url || 'Nova aba'
    const url = tab.url || ''

    preview.innerHTML = `
      <div class="tab-preview-title">${title}</div>
      <div class="tab-preview-url">${url}</div>
      <div class="tab-preview-thumb" id="tab-preview-thumb">
        <div class="tab-preview-loading"></div>
      </div>`

    document.body.appendChild(preview)

    // Position below the tab
    const pw = 220, ph = 160
    let left = rect.left + rect.width / 2 - pw / 2
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
    preview.style.left = left + 'px'
    preview.style.top = (rect.bottom + 6) + 'px'
    preview.style.width = pw + 'px'

    // Try to capture webview screenshot
    if (tab.webviewEl) {
      try {
        tab.webviewEl.capturePage().then(img => {
          const thumb = document.getElementById('tab-preview-thumb')
          if (!thumb) return
          if (img && img.toDataURL) {
            const url = img.toDataURL()
            thumb.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:4px">`
          } else {
            thumb.innerHTML = `<div class="tab-preview-noimg">${title.charAt(0).toUpperCase()}</div>`
          }
        }).catch(() => {})
      } catch {}
    }
  }

  _hideTabPreview() {
    document.getElementById('tab-preview')?.remove()
  }

  _showTabContextMenu(x, y, tab) {
    document.querySelector('#tab-ctx')?.remove()
    const menu = document.createElement('div')
    menu.id = 'tab-ctx'
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--panel-bg);border:1px solid var(--border);border-radius:12px;padding:5px;z-index:99999;box-shadow:0 6px 24px rgba(0,0,0,.2);min-width:180px`

    const items = [
      { label: 'Nova aba à direita', action: () => this.createTab() },
      { label: 'Duplicar aba', action: () => this.createTab({ url: tab.url }) },
      { label: 'Abrir em Split View', action: () => this._openSplitView(tab.url) },
      { type: 'sep' },
      { label: tab.muted ? 'Ativar som' : 'Silenciar aba', action: () => this._toggleTabMute(tab) },
      { label: tab.pinned ? 'Desafixar aba' : 'Fixar aba', action: () => this._toggleTabPin(tab) },
      { label: 'Cor do grupo…', action: () => this._showTabGroupPicker(tab) },
      { type: 'sep' },
      { label: 'Fechar aba', action: () => this.closeTab(tab.id), red: true },
      { label: 'Fechar outras abas', action: () => {
          this.tabs.filter(t => t.id !== tab.id).forEach(t => this.closeTab(t.id))
        }, red: true },
      ...(this.closedTabs?.length ? [{ type: 'sep' }, { label: `Reabrir "${this.closedTabs[0]?.title?.slice(0, 24) || 'aba fechada'}"`, action: () => this._reopenLastTab() }] : []),
    ]

    items.forEach(item => {
      if (item.type === 'sep') {
        const sep = document.createElement('div')
        sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0'
        menu.appendChild(sep)
        return
      }
      const btn = document.createElement('button')
      btn.style.cssText = `display:flex;align-items:center;width:100%;padding:8px 12px;border:none;background:transparent;color:${item.red ? 'var(--red)' : 'var(--text-1)'};cursor:pointer;border-radius:7px;font-size:13px;text-align:left`
      btn.textContent = item.label
      btn.onmouseenter = () => btn.style.background = 'var(--card-bg)'
      btn.onmouseleave = () => btn.style.background = 'transparent'
      btn.addEventListener('click', () => { item.action(); menu.remove() })
      menu.appendChild(btn)
    })

    document.body.appendChild(menu)
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close) } }
    setTimeout(() => document.addEventListener('mousedown', close), 10)
  }

  _showTabGroupPicker(tab) {
    document.querySelector('#tg-picker')?.remove()
    const colors = [
      { name: 'Nenhum', color: null },
      { name: 'Vermelho', color: '#FF3B30' },
      { name: 'Laranja', color: '#FF9500' },
      { name: 'Amarelo', color: '#FFCC00' },
      { name: 'Verde', color: '#34C759' },
      { name: 'Azul', color: '#007AFF' },
      { name: 'Roxo', color: '#AF52DE' },
      { name: 'Rosa', color: '#FF2D55' },
    ]
    const picker = document.createElement('div')
    picker.id = 'tg-picker'
    const rect = tab.tabEl?.getBoundingClientRect() || { left: 200, bottom: 60 }
    picker.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;background:var(--panel-bg);border:1px solid var(--border);border-radius:12px;padding:8px;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.2);display:flex;gap:6px;flex-wrap:wrap;max-width:200px`

    colors.forEach(({ name, color }) => {
      const btn = document.createElement('button')
      btn.style.cssText = `width:24px;height:24px;border-radius:50%;border:2px solid ${color ? 'transparent' : 'var(--border)'};background:${color || 'var(--card-bg)'};cursor:pointer;transition:transform .1s`
      btn.title = name
      if (!color) btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      btn.onmouseenter = () => btn.style.transform = 'scale(1.2)'
      btn.onmouseleave = () => btn.style.transform = ''
      btn.addEventListener('click', () => {
        tab.groupColor = color
        if (tab.tabEl) {
          tab.tabEl.style.borderTop = color ? `2px solid ${color}` : ''
          tab.tabEl.style.borderTopLeftRadius = color ? '4px' : ''
          tab.tabEl.style.borderTopRightRadius = color ? '4px' : ''
        }
        picker.remove()
      })
      picker.appendChild(btn)
    })

    document.body.appendChild(picker)
    const close = (e) => { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('mousedown', close) } }
    setTimeout(() => document.addEventListener('mousedown', close), 10)
  }

  _toggleTabPin(tab) {
    tab.pinned = !tab.pinned
    if (tab.tabEl) {
      tab.tabEl.classList.toggle('tab-pinned', tab.pinned)
    }
    if (tab.pinned && this._activeTab()?.id === tab.id) {
      const t = tab.tabEl?.querySelector('.tab-title')
      if (t) t.style.display = 'none'
      const x = tab.tabEl?.querySelector('.tab-x')
      if (x) x.style.display = 'none'
    } else {
      const t = tab.tabEl?.querySelector('.tab-title')
      if (t) t.style.display = ''
      const x = tab.tabEl?.querySelector('.tab-x')
      if (x) x.style.display = ''
    }
    this._showToast(tab.pinned ? 'Aba fixada' : 'Aba desafixada', 'success')
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
        this._pulseAddressBar()
      }
      this._trackVisit(e.url)
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

    wv.addEventListener('media-started-playing', () => {
      tab.hasMedia = true
      this._updateTabMuteBtn(tab)
    })
    wv.addEventListener('media-paused', () => {
      tab.hasMedia = false
      this._updateTabMuteBtn(tab)
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

    if (!q) { el.classList.add('hidden'); return }

    // Bookmarks first
    try {
      const bms = JSON.parse(localStorage.getItem('lumen_bookmarks') || '[]')
      bms.filter(b => b.url?.toLowerCase().includes(q) || b.label?.toLowerCase().includes(q))
        .slice(0, 3)
        .forEach(b => items.push({ type: 'bookmark', url: b.url, label: b.label || b.url }))
    } catch {}

    // Full history matches (most recent unique URLs)
    try {
      const hist = JSON.parse(localStorage.getItem('lumen_history') || '[]')
      const seen = new Set(items.map(i => i.url))
      hist.filter(h => (h.url?.toLowerCase().includes(q) || h.title?.toLowerCase().includes(q)) && !seen.has(h.url))
        .reduce((acc, h) => { if (!acc.find(x => x.url === h.url)) acc.push(h); return acc }, [])
        .slice(0, 4)
        .forEach(h => { seen.add(h.url); items.push({ type: 'history', url: h.url, label: h.title || h.url }) })
    } catch {}

    // Search suggestion at bottom if query is not a URL
    if (!q.includes('.') || q.includes(' ')) {
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

      let iconHtml
      if (item.type === 'search') {
        iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      } else {
        try {
          const domain = new URL(item.url).hostname
          const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
          const bookmarkBadge = item.type === 'bookmark' ? `<span class="addr-sug-bm-badge"><svg width="8" height="8" viewBox="0 0 24 24" fill="var(--accent)"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></span>` : ''
          iconHtml = `<span class="addr-sug-fav-wrap"><img src="${faviconUrl}" width="14" height="14" style="border-radius:3px;object-fit:cover" onerror="this.style.display='none'">${bookmarkBadge}</span>`
        } catch {
          iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
        }
      }

      const safeLabel = item.label.replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;')
      const labelHl = safeLabel.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<span class="addr-sug-match">${m}</span>`)
      div.innerHTML = `<span class="addr-sug-icon">${iconHtml}</span><span class="addr-sug-text"><div class="addr-sug-label">${labelHl}</div>${item.type !== 'search' ? `<div class="addr-sug-url">${item.url}</div>` : ''}</span>`

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
      // Update history entries with real title
      const hist = JSON.parse(localStorage.getItem('lumen_history') || '[]')
      let changed = false
      for (let i = 0; i < Math.min(5, hist.length); i++) {
        if (hist[i].url === url && (!hist[i].title || hist[i].title === domain)) {
          hist[i].title = title; changed = true
        }
      }
      if (changed) localStorage.setItem('lumen_history', JSON.stringify(hist))
    } catch {}
  }

  _trackVisit(url) {
    try {
      if (!url || url.startsWith('lumen://') || url.startsWith('chrome://') || url.startsWith('about:')) return
      const u = new URL(url)
      const domain = u.hostname.replace(/^www\./, '')
      if (!domain) return

      // Per-domain visit counts (for NTP suggestions)
      const visits = JSON.parse(localStorage.getItem('lumen_visits') || '{}')
      visits[domain] = { count: ((visits[domain]?.count) || 0) + 1, url, title: domain }
      localStorage.setItem('lumen_visits', JSON.stringify(visits))

      // Full history (chronological, max 1000 entries)
      const hist = JSON.parse(localStorage.getItem('lumen_history') || '[]')
      hist.unshift({ url, title: document.title || domain, ts: Date.now() })
      if (hist.length > 1000) hist.length = 1000
      localStorage.setItem('lumen_history', JSON.stringify(hist))

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
        icon.classList.add('loading')
        const img = document.createElement('img')
        img.style.cssText = 'width:42px;height:42px;border-radius:10px;object-fit:contain'
        img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
        img.onload = () => { icon.classList.remove('loading'); icon.style.background = '' }
        img.onerror = () => {
          img.remove()
          icon.classList.remove('loading')
          icon.style.background = this._domainColor(domain)
          icon.innerHTML = `<span style="font-size:26px;font-weight:700;color:white">${domain[0].toUpperCase()}</span>`
        }
        icon.appendChild(img)
      } catch {}
    }

    // Notes badge
    try {
      const noteKey = 'lumen_note_' + new URL(site.url).hostname
      if (localStorage.getItem(noteKey)) {
        const badge = document.createElement('span')
        badge.title = 'Tem notas'
        badge.style.cssText = 'position:absolute;top:-2px;left:-2px;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--ntp-bg,#18181B);z-index:3'
        wrap.appendChild(badge)
      }
    } catch {}

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

    if (url.startsWith('https://') || url.startsWith('lumen://')) {
      si.style.display = ''
      si.style.color = ''
      si.title = 'Conexão segura'
      si.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    } else if (url.startsWith('http://')) {
      si.style.display = ''
      si.style.color = '#FF9500'
      si.title = 'Conexão não segura (HTTP)'
      si.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/><line x1="12" y1="15" x2="12" y2="15.01"/></svg>'
    } else {
      si.style.display = 'none'
    }
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

  _toggleFocusMode() {
    const browser = this.$('browser') || document.getElementById('browser')
    const chrome = document.getElementById('tab-bar')
    const toolbar = document.getElementById('toolbar')
    const bm = document.getElementById('bm-bar')
    const sidebar = document.getElementById('sidebar')

    this.focusMode = !this.focusMode

    ;[chrome, toolbar, bm, sidebar].forEach(el => {
      if (el) el.style.display = this.focusMode ? 'none' : ''
    })

    if (this.focusMode) {
      this._showToast('Modo foco ativo — Cmd+Shift+K para sair', 'info')
    }
  }

  _toggleShortcutsHelp() {
    const existing = document.getElementById('shortcuts-overlay')
    if (existing) { existing.remove(); return }

    const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
    const shortcuts = [
      // Navigation
      ['Nova aba', `${mod}+T`], ['Fechar aba', `${mod}+W`],
      ['Reabrir aba fechada', `${mod}+Shift+T`], ['Aba incógnita', `${mod}+Shift+N`],
      ['Próxima / anterior', `${mod}+] / [`], ['Ir para aba 1–9', `${mod}+1–9`],
      ['Barra de endereço', `${mod}+L`], ['Recarregar', `${mod}+R`],
      // Tools
      ['Paleta de comandos', `${mod}+K`], ['Histórico', `${mod}+H`],
      ['Buscar na página', `${mod}+F`], ['Lumen AI', `${mod}+Shift+A`],
      ['Notas da página', `${mod}+Shift+N`], ['Screenshot', `${mod}+Shift+S`],
      ['Vista dividida', `${mod}+Shift+E`], ['Modo foco', `${mod}+Shift+K`],
      // Zoom
      ['Zoom in / out', `${mod}+= / -`], ['Zoom reset', `${mod}+0`],
      // Other
      ['Picture-in-Picture', `${mod}+Shift+P`], ['Modo leitura', `${mod}+U`],
      ['Fixar no NTP', `${mod}+D`], ['Sidebar', `${mod}+B`],
      ['Configurações', `${mod}+,`], ['DevTools', `${mod}+Shift+I`],
      ['Este painel', `${mod}+?`],
    ]

    const overlay = document.createElement('div')
    overlay.id = 'shortcuts-overlay'
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)`
    overlay.innerHTML = `
      <div style="background:var(--panel-bg);border:1px solid var(--border);border-radius:18px;padding:28px 32px;min-width:380px;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="font-size:17px;font-weight:700;color:var(--text-1);margin-bottom:20px">Atalhos de teclado</div>
        <table style="width:100%;border-collapse:collapse">
          ${shortcuts.map(([label, key]) => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 0;font-size:13px;color:var(--text-2)">${label}</td>
              <td style="padding:8px 0;text-align:right">
                ${key.split('+').map(k => `<kbd style="display:inline-block;padding:2px 7px;background:var(--card-bg);border:1px solid var(--border);border-radius:5px;font-size:11px;font-family:ui-monospace,monospace;color:var(--text-1)">${k}</kbd>`).join('<span style="color:var(--text-3);padding:0 3px;font-size:11px">+</span>')}
              </td>
            </tr>`).join('')}
        </table>
        <div style="margin-top:16px;text-align:center;font-size:12px;color:var(--text-3)">Pressione ${mod}+? para fechar</div>
      </div>`
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
  }

  _initTabDeck() {
    const deck = this.$('tab-deck')
    if (!deck) return

    this.$('tab-deck-backdrop')?.addEventListener('click', () => this._closeTabDeck())
    this.$('tab-deck-close')?.addEventListener('click', () => this._closeTabDeck())

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !deck.classList.contains('hidden')) this._closeTabDeck()
    })
  }

  async _openTabDeck() {
    const deck = this.$('tab-deck')
    if (!deck) return
    deck.classList.remove('hidden')
    await this._renderTabDeck()
  }

  _closeTabDeck() {
    this.$('tab-deck')?.classList.add('hidden')
  }

  async _renderTabDeck() {
    const grid = this.$('tab-deck-grid')
    if (!grid) return
    grid.innerHTML = ''

    this.$('tab-deck-title').textContent = `${this.tabs.length} aba${this.tabs.length !== 1 ? 's' : ''} abertas`

    const cards = await Promise.all(this.tabs.map(async (tab) => {
      const card = document.createElement('div')
      card.className = 'deck-card' + (tab.id === this.activeId ? ' active' : '')

      const thumb = document.createElement('div')
      thumb.className = 'deck-thumb'

      if (tab.webviewEl) {
        try {
          const img = await tab.webviewEl.capturePage()
          if (img) {
            const el = document.createElement('img')
            el.src = img.toDataURL()
            thumb.appendChild(el)
          } else throw new Error()
        } catch {
          thumb.innerHTML = `<span class="deck-thumb-placeholder">🌐</span>`
        }
      } else {
        thumb.innerHTML = `<span class="deck-thumb-placeholder">🆕</span>`
      }

      const info = document.createElement('div')
      info.className = 'deck-info'

      let faviconUrl = ''
      try { faviconUrl = `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=32` } catch {}

      info.innerHTML = `${faviconUrl ? `<img class="deck-favicon" src="${faviconUrl}" onerror="this.style.display='none'">` : ''}<span class="deck-name" title="${tab.title || tab.url || 'Nova aba'}">${tab.title || tab.url || 'Nova aba'}</span>`

      const closeBtn = document.createElement('button')
      closeBtn.className = 'deck-close-btn'
      closeBtn.innerHTML = '<svg width="9" height="9" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.closeTab(tab.id)
        card.remove()
        const remaining = grid.querySelectorAll('.deck-card').length
        this.$('tab-deck-title').textContent = `${remaining} aba${remaining !== 1 ? 's' : ''} aberta${remaining !== 1 ? 's' : ''}`
        if (remaining === 0) this._closeTabDeck()
      })

      card.append(thumb, info, closeBtn)
      card.addEventListener('click', () => {
        this.switchTab(tab.id)
        this._closeTabDeck()
      })

      return card
    }))

    cards.forEach(c => grid.appendChild(c))
  }

  _initCommandPalette() {
    this.cmdActive = 0

    const palette = this.$('cmd-palette')
    const input = this.$('cmd-input')
    const results = this.$('cmd-results')
    if (!palette || !input || !results) return

    this.$('cmd-backdrop')?.addEventListener('click', () => this._closeCommandPalette())

    input.addEventListener('input', () => this._cmdRender(input.value.trim()))
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.cmd-item')
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.cmdActive = Math.min(this.cmdActive + 1, items.length - 1)
        this._cmdHighlight(items)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        this.cmdActive = Math.max(this.cmdActive - 1, 0)
        this._cmdHighlight(items)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        items[this.cmdActive]?.click()
      } else if (e.key === 'Escape') {
        this._closeCommandPalette()
      }
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !palette.classList.contains('hidden')) {
        this._closeCommandPalette()
      }
    })
  }

  _openCommandPalette() {
    const palette = this.$('cmd-palette')
    if (!palette) return
    palette.classList.remove('hidden')
    const input = this.$('cmd-input')
    input.value = ''
    this.cmdActive = 0
    this._cmdRender('')
    requestAnimationFrame(() => input?.focus())
  }

  _closeCommandPalette() {
    this.$('cmd-palette')?.classList.add('hidden')
  }

  _cmdHighlight(items) {
    items.forEach((el, i) => el.classList.toggle('cmd-active', i === this.cmdActive))
    items[this.cmdActive]?.scrollIntoView({ block: 'nearest' })
  }

  _cmdIcon(svg) {
    return `<span class="cmd-item-icon">${svg}</span>`
  }

  _cmdRender(query) {
    const results = this.$('cmd-results')
    if (!results) return
    const q = query.toLowerCase()

    const ACTIONS = [
      { label: 'Nova aba',              kbd: '⌘T',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>', fn: () => this.createTab() },
      { label: 'Nova aba incógnito',    kbd: '⌘⇧N',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>', fn: () => this.createTab({ incognito: true }) },
      { label: 'Fechar aba',            kbd: '⌘W',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>', fn: () => this.closeTab(this.activeId) },
      { label: 'Recarregar página',     kbd: '⌘R',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>', fn: () => this._activeWV()?.reload() },
      { label: 'Histórico',             kbd: '⌘H',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><line x1="12" y1="9" x2="12" y2="13l2 2"/></svg>', fn: () => this._openHistory() },
      { label: 'Bookmarks — adicionar', kbd: '',          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>', fn: () => this._addCurrentPageBookmark() },
      { label: 'Zoom — aumentar',       kbd: '⌘+',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>', fn: () => this._zoom(1) },
      { label: 'Zoom — diminuir',       kbd: '⌘-',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>', fn: () => this._zoom(-1) },
      { label: 'Zoom — redefinir',      kbd: '⌘0',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', fn: () => this._zoom(0) },
      { label: 'Buscar na página',      kbd: '⌘F',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', fn: () => this._openFind() },
      { label: 'Modo leitura',          kbd: '⌘U',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>', fn: () => this._toggleReadingMode() },
      { label: 'Picture-in-Picture',    kbd: '⌘⇧P',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="12" y="11" width="9" height="6" rx="1"/></svg>', fn: () => this._togglePiP() },
      { label: 'Modo foco',             kbd: '⌘⇧K',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>', fn: () => this._toggleFocusMode() },
      { label: 'Visão geral de abas',    kbd: '⌘⇧D',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>', fn: () => this._openTabDeck() },
      { label: 'Notas da página',        kbd: '⌘⇧N',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', fn: () => this._toggleNotes() },
      { label: 'Screenshot',             kbd: '⌘⇧S',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>', fn: () => this._captureScreenshot() },
      { label: 'Lumen AI',              kbd: '⌘⇧A',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', fn: () => this._toggleAIPanel() },
      { label: 'Vista dividida',        kbd: '⌘⇧E',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>', fn: () => this.splitActive ? this._closeSplitView() : this._openSplitView() },
      { label: 'Configurações',         kbd: '⌘,',       icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', fn: () => this._toggleSettings() },
      { label: 'DevTools',              kbd: '⌘⇧I',      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>', fn: () => { const wv = this._activeWV(); if (wv) wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools() } },
    ]

    const tabIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'
    const histIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'

    let html = ''

    // ── Actions
    const matchedActions = q ? ACTIONS.filter(a => a.label.toLowerCase().includes(q)) : ACTIONS
    if (matchedActions.length) {
      html += `<div class="cmd-section-label">${q ? 'Ações' : 'Ações rápidas'}</div>`
      matchedActions.slice(0, 8).forEach(a => {
        html += `<div class="cmd-item" data-cmd-fn="${encodeURIComponent(a.label)}">
          ${this._cmdIcon(a.icon)}
          <span class="cmd-item-label">${a.label}</span>
          ${a.kbd ? `<kbd class="cmd-item-kbd">${a.kbd}</kbd>` : ''}
        </div>`
      })
    }

    // ── Tabs
    const matchedTabs = this.tabs.filter(t => {
      const title = (t.title || t.url || '').toLowerCase()
      return !q || title.includes(q)
    })
    if (matchedTabs.length) {
      html += `<div class="cmd-section-label">Abas abertas</div>`
      matchedTabs.slice(0, 5).forEach(t => {
        const label = t.title || t.url || 'Nova aba'
        const sub = t.url || ''
        html += `<div class="cmd-item" data-cmd-tab="${t.id}">
          ${this._cmdIcon(tabIcon)}
          <span class="cmd-item-label">${label}</span>
          <span class="cmd-item-sub">${sub}</span>
        </div>`
      })
    }

    // ── History
    if (q) {
      try {
        const history = JSON.parse(localStorage.getItem('lumen_history') || '[]')
        const matchedHist = history.filter(h => {
          const s = ((h.title || '') + ' ' + (h.url || '')).toLowerCase()
          return s.includes(q)
        })
        if (matchedHist.length) {
          html += `<div class="cmd-section-label">Histórico</div>`
          matchedHist.slice(0, 5).forEach(h => {
            html += `<div class="cmd-item" data-cmd-url="${encodeURIComponent(h.url)}">
              ${this._cmdIcon(histIcon)}
              <span class="cmd-item-label">${h.title || h.url}</span>
              <span class="cmd-item-sub">${h.url}</span>
            </div>`
          })
        }
      } catch {}
    }

    results.innerHTML = html
    this.cmdActive = 0

    // Wire click handlers
    results.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.addEventListener('mouseenter', () => {
        this.cmdActive = i
        this._cmdHighlight(results.querySelectorAll('.cmd-item'))
      })
      el.addEventListener('click', () => {
        const fnLabel = el.dataset.cmdFn
        const tabId = el.dataset.cmdTab
        const url = el.dataset.cmdUrl

        this._closeCommandPalette()

        if (fnLabel) {
          const action = ACTIONS.find(a => encodeURIComponent(a.label) === fnLabel)
          action?.fn()
        } else if (tabId) {
          this.switchTab(tabId)
        } else if (url) {
          this._navigate(decodeURIComponent(url))
        }
      })
    })

    this._cmdHighlight(results.querySelectorAll('.cmd-item'))
  }

  _initAIPanel() {
    this.aiHistory = []

    this.$('sbar-ai-btn')?.addEventListener('click', () => this._toggleAIPanel())
    this.$('ai-close')?.addEventListener('click', () => this._closeAIPanel())

    const apiKey = localStorage.getItem('lumen_ai_key')
    if (!apiKey) {
      this.$('ai-api-setup')?.classList.remove('hidden')
    }

    this.$('ai-api-save-btn')?.addEventListener('click', () => {
      const key = this.$('ai-api-key-input')?.value?.trim()
      if (!key?.startsWith('sk-ant-')) { this._showToast('Chave inválida — deve começar com sk-ant-', 'error'); return }
      localStorage.setItem('lumen_ai_key', key)
      this.$('ai-api-setup')?.classList.add('hidden')
      this._showToast('Chave de API salva', 'success')
    })

    const sendFn = () => {
      const input = this.$('ai-input')
      const text = input?.value?.trim()
      if (!text) return
      input.value = ''
      input.style.height = ''
      this._aiSend(text)
    }

    this.$('ai-send-btn')?.addEventListener('click', sendFn)
    this.$('ai-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFn() }
    })
    this.$('ai-input')?.addEventListener('input', (e) => {
      e.target.style.height = 'auto'
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
    })
  }

  _toggleAIPanel() {
    const panel = this.$('ai-panel')
    if (panel?.classList.contains('hidden')) {
      panel.classList.remove('hidden')
      this.$('ai-input')?.focus()
    } else {
      this._closeAIPanel()
    }
  }

  _closeAIPanel() {
    this.$('ai-panel')?.classList.add('hidden')
  }

  async _aiSend(text) {
    const apiKey = localStorage.getItem('lumen_ai_key')
    if (!apiKey) {
      this.$('ai-api-setup')?.classList.remove('hidden')
      return
    }

    // Add user message
    this._aiAppendMsg(text, 'user')
    this.aiHistory.push({ role: 'user', content: text })

    // Get page context
    let pageCtx = ''
    try {
      const tab = this._activeTab()
      if (tab?.url && !tab.url.startsWith('lumen://')) {
        const result = await this._activeWV()?.executeJavaScript(`document.title + '\\n\\n' + document.body?.innerText?.slice(0, 2000)`)
        pageCtx = result || ''
      }
    } catch {}

    // Loading indicator
    const loadingEl = this._aiAppendMsg('Pensando…', 'assistant loading')

    try {
      const sysPrompt = `Você é Lumen AI, o assistente nativo do Lumen's Browser. Responda de forma concisa e útil.${pageCtx ? `\n\nPágina atual:\n${pageCtx}` : ''}`

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: sysPrompt,
          messages: this.aiHistory,
        })
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error?.message || `HTTP ${resp.status}`)
      }

      const data = await resp.json()
      const reply = data.content?.[0]?.text || '(sem resposta)'
      this.aiHistory.push({ role: 'assistant', content: reply })

      loadingEl.remove()
      this._aiAppendMsg(reply, 'assistant')

      // Keep history at max 20 messages
      if (this.aiHistory.length > 20) this.aiHistory = this.aiHistory.slice(-20)
    } catch (err) {
      loadingEl.remove()
      this._aiAppendMsg(`Erro: ${err.message}`, 'assistant')
    }
  }

  _aiAppendMsg(text, type) {
    const msgs = this.$('ai-messages')
    if (!msgs) return null
    const div = document.createElement('div')
    div.className = `ai-msg ${type}`
    div.textContent = text
    msgs.appendChild(div)
    msgs.scrollTop = msgs.scrollHeight
    return div
  }

  _initWeather() {
    const cached = localStorage.getItem('lumen_weather_cache')
    if (cached) {
      try {
        const { data, ts } = JSON.parse(cached)
        if (Date.now() - ts < 30 * 60 * 1000) { this._showWeather(data); return }
      } catch {}
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords
          const [weatherResp, geoResp] = await Promise.all([
            fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`),
            fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
          ])
          const weather = await weatherResp.json()
          const geo = await geoResp.json()

          const city = geo.address?.city || geo.address?.town || geo.address?.village || ''
          const wc = weather.current_weather?.weathercode ?? -1
          const temp = weather.current_weather?.temperature ?? null

          const data = { temp, wc, city }
          localStorage.setItem('lumen_weather_cache', JSON.stringify({ data, ts: Date.now() }))
          this._showWeather(data)
        } catch {}
      },
      () => {}, // denied — silently skip
      { timeout: 5000 }
    )
  }

  _showWeather({ temp, wc, city }) {
    const el = this.$('ntp-weather')
    if (!el || temp === null) return

    const WMO_ICONS = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
      45: '🌫️', 48: '🌫️',
      51: '🌦️', 53: '🌦️', 55: '🌧️',
      61: '🌧️', 63: '🌧️', 65: '🌧️',
      71: '🌨️', 73: '🌨️', 75: '🌨️',
      80: '🌦️', 81: '🌧️', 82: '⛈️',
      95: '⛈️', 96: '⛈️', 99: '⛈️',
    }
    const WMO_DESC = {
      0: 'Céu limpo', 1: 'Principalmente limpo', 2: 'Parcialmente nublado', 3: 'Nublado',
      45: 'Neblina', 48: 'Neblina',
      51: 'Chuvisco leve', 53: 'Chuvisco', 55: 'Chuvisco denso',
      61: 'Chuva leve', 63: 'Chuva', 65: 'Chuva forte',
      71: 'Neve leve', 73: 'Neve', 75: 'Neve intensa',
      80: 'Pancadas leves', 81: 'Pancadas', 82: 'Pancadas fortes',
      95: 'Trovoada', 96: 'Trovoada c/ granizo', 99: 'Trovoada forte',
    }

    const icon = WMO_ICONS[wc] ?? '🌡️'
    const desc = WMO_DESC[wc] ?? ''

    this.$('ntp-weather-icon').textContent = icon
    this.$('ntp-weather-temp').textContent = `${Math.round(temp)}°C`
    this.$('ntp-weather-desc').textContent = desc
    this.$('ntp-weather-city').textContent = city
    el.classList.remove('hidden')
  }

  async _captureScreenshot() {
    const wv = this._activeWV()
    if (!wv) { this._showToast('Nenhuma página para capturar', 'info', 2000); return }
    try {
      const img = await wv.capturePage()
      if (!img) throw new Error('Falha ao capturar')
      const dataUrl = img.toDataURL()
      const tab = this._activeTab()
      let hostname = 'screenshot'
      try { hostname = new URL(tab?.url || '').hostname || 'screenshot' } catch {}
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `Lumen-${hostname}-${ts}.png`
      const savedPath = await window.lumen?.saveScreenshot?.({ dataUrl, filename })
      if (savedPath) {
        this._showToast(`Screenshot salvo em Imagens`, 'success', 3000)
      } else {
        // Fallback: copy to clipboard
        const blob = await fetch(dataUrl).then(r => r.blob())
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        this._showToast('Screenshot copiado para a área de transferência', 'success', 3000)
      }
    } catch (err) {
      this._showToast(`Erro: ${err.message}`, 'error')
    }
  }

  _initNotes() {
    const panel = this.$('notes-panel')
    if (!panel) return

    this.$('notes-btn')?.addEventListener('click', () => this._toggleNotes())
    this.$('notes-close')?.addEventListener('click', () => this._closeNotes())

    const textarea = this.$('notes-textarea')
    let saveTimer

    textarea?.addEventListener('input', () => {
      const count = textarea.value.length
      this.$('notes-char-count').textContent = count > 0 ? `${count} car.` : ''

      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        this._saveNoteForCurrentPage(textarea.value)
        const hint = this.$('notes-saved-hint')
        if (hint) { hint.textContent = 'Salvo'; hint.style.opacity = '1'; setTimeout(() => hint.style.opacity = '0', 1500) }
      }, 800)
    })

    this.$('notes-clear-btn')?.addEventListener('click', () => {
      if (!textarea.value) return
      textarea.value = ''
      this.$('notes-char-count').textContent = ''
      this._saveNoteForCurrentPage('')
    })
  }

  _toggleNotes() {
    const panel = this.$('notes-panel')
    if (panel?.classList.contains('hidden')) {
      panel.classList.remove('hidden')
      this._loadNoteForCurrentPage()
      this.$('notes-textarea')?.focus()
    } else {
      this._closeNotes()
    }
  }

  _closeNotes() {
    this.$('notes-panel')?.classList.add('hidden')
  }

  _noteKey(url) {
    try { return 'lumen_note_' + new URL(url).hostname } catch { return null }
  }

  _loadNoteForCurrentPage() {
    const url = this._activeTab()?.url || ''
    const key = this._noteKey(url)
    const textarea = this.$('notes-textarea')
    if (!textarea) return

    if (!key || url.startsWith('lumen://')) {
      textarea.value = ''
      textarea.placeholder = 'Notas não disponíveis para esta página'
      textarea.disabled = true
      this.$('notes-domain-label').textContent = ''
      return
    }

    textarea.disabled = false
    textarea.placeholder = 'Escreva notas sobre esta página…'
    const note = localStorage.getItem(key) || ''
    textarea.value = note
    this.$('notes-char-count').textContent = note.length > 0 ? `${note.length} car.` : ''

    try {
      this.$('notes-domain-label').textContent = new URL(url).hostname
    } catch {}
  }

  _saveNoteForCurrentPage(text) {
    const url = this._activeTab()?.url || ''
    const key = this._noteKey(url)
    if (!key) return
    if (text) localStorage.setItem(key, text)
    else localStorage.removeItem(key)
  }

  _initPermissions() {
    const bar = this.$('perm-bar')
    if (!bar) return

    let pendingPerm = null

    window.lumen?.onPermRequest?.((data) => {
      pendingPerm = data
      const labels = {
        notification: 'notificações',
        media: 'câmera/microfone',
      }
      const label = labels[data.type] || data.permission
      this.$('perm-bar-text').textContent = `${data.origin} quer acesso a ${label}`
      bar.classList.remove('hidden')
    })

    this.$('perm-bar-allow')?.addEventListener('click', () => {
      if (!pendingPerm) return
      window.lumen?.respondPerm?.({ ...pendingPerm, granted: true })
      bar.classList.add('hidden')
      this._showToast(`Permissão concedida a ${pendingPerm.origin}`, 'success', 3000)
      pendingPerm = null
    })

    this.$('perm-bar-deny')?.addEventListener('click', () => {
      if (!pendingPerm) return
      window.lumen?.respondPerm?.({ ...pendingPerm, granted: false })
      bar.classList.add('hidden')
      pendingPerm = null
    })

    // Permissions settings panel
    this.$('perm-notify-clear')?.addEventListener('click', async () => {
      window.lumen?.revokeAllPermissions?.({ type: 'notification' })
      this._showToast('Permissões de notificação revogadas', 'success', 2000)
      await this._renderPermissionsList()
    })

    this.$('perm-media-clear')?.addEventListener('click', async () => {
      window.lumen?.revokeAllPermissions?.({ type: 'media' })
      this._showToast('Permissões de mídia revogadas', 'success', 2000)
      await this._renderPermissionsList()
    })
  }

  async _renderPermissionsList() {
    const perms = await window.lumen?.getPermissions?.()
    if (!perms) return

    const renderList = (containerId, type, origins) => {
      const el = this.$(containerId)
      if (!el) return
      if (!origins.length) {
        el.innerHTML = `<div style="color:var(--text-3);font-size:12px;padding:4px 0">Nenhum site tem essa permissão</div>`
        return
      }
      el.innerHTML = origins.map(o => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;color:var(--text-1)">${o}</span>
          <button class="setting-btn" data-revoke-origin="${o}" data-revoke-type="${type}" style="padding:3px 10px;font-size:11px">Revogar</button>
        </div>`).join('')
      el.querySelectorAll('[data-revoke-origin]').forEach(btn => {
        btn.addEventListener('click', async () => {
          window.lumen?.revokePermission?.({ origin: btn.dataset.revokeOrigin, type: btn.dataset.revokeType })
          await this._renderPermissionsList()
        })
      })
    }

    renderList('perm-notify-list', 'notification', perms.notification || [])
    renderList('perm-media-list', 'media', perms.media || [])
  }

  _initDataExport() {
    this.$('export-data-btn')?.addEventListener('click', () => {
      const data = {
        version: 1,
        exported: new Date().toISOString(),
        bookmarks: JSON.parse(localStorage.getItem('lumen_bookmarks') || '[]'),
        pinnedSites: JSON.parse(localStorage.getItem('lumen_pinned') || '[]'),
        prefs: JSON.parse(localStorage.getItem('lumen_prefs') || '{}'),
        history: JSON.parse(localStorage.getItem('lumen_history') || '[]').slice(0, 500),
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `lumen-data-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      this._showToast('Dados exportados com sucesso', 'success')
    })

    this.$('import-data-btn')?.addEventListener('click', () => {
      this.$('import-file-input')?.click()
    })

    this.$('import-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result)
          if (data.version !== 1) throw new Error('Formato desconhecido')

          if (data.bookmarks?.length) localStorage.setItem('lumen_bookmarks', JSON.stringify(data.bookmarks))
          if (data.pinnedSites?.length) localStorage.setItem('lumen_pinned', JSON.stringify(data.pinnedSites))
          if (data.prefs) localStorage.setItem('lumen_prefs', JSON.stringify(data.prefs))
          if (data.history?.length) {
            const existing = JSON.parse(localStorage.getItem('lumen_history') || '[]')
            const merged = [...data.history, ...existing]
              .reduce((acc, h) => { if (!acc.find(x => x.url === h.url && Math.abs(x.ts - h.ts) < 60000)) acc.push(h); return acc }, [])
              .slice(0, 1000)
            localStorage.setItem('lumen_history', JSON.stringify(merged))
          }

          this._renderBookmarksBar()
          this._renderNTPTiles()
          this._showToast('Dados importados com sucesso', 'success')
        } catch (err) {
          this._showToast(`Erro ao importar: ${err.message}`, 'error')
        }
        e.target.value = ''
      }
      reader.readAsText(file)
    })
  }

  _initNTPQuickActions() {
    document.querySelectorAll('.nqa-btn[data-nqa]').forEach(btn => {
      btn.addEventListener('click', () => {
        switch (btn.dataset.nqa) {
          case 'history':    this._openHistory(); break
          case 'bookmarks':  this._toggleSettings(); setTimeout(() => {
            document.querySelector('.settings-nav[data-section="appearance"]')?.click()
          }, 100); break
          case 'incognito':  this.createTab({ incognito: true }); break
          case 'downloads':  this.$('dl-tray')?.classList.remove('hidden'); break
          case 'settings':   this._toggleSettings(); break
        }
      })
    })
  }

  _initSplitView() {
    this.splitActive = false
    this.splitWV = null

    const divider = this.$('split-divider')
    const pane = this.$('split-pane')
    const close = this.$('split-close')
    const addr = this.$('split-addr')

    close?.addEventListener('click', () => this._closeSplitView())

    addr?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = this._resolveURL(addr.value.trim())
        addr.value = url
        this.splitWV?.loadURL(url)
      }
    })

    // Drag-to-resize divider
    if (divider) {
      let startX = 0, startW1 = 0, startW2 = 0
      divider.addEventListener('mousedown', (e) => {
        startX = e.clientX
        const wa = this.$('webview-area')
        const sp = this.$('split-pane')
        startW1 = wa.offsetWidth
        startW2 = sp.offsetWidth
        divider.classList.add('dragging')

        const onMove = (ev) => {
          const dx = ev.clientX - startX
          const total = startW1 + startW2
          const newW1 = Math.max(280, Math.min(total - 280, startW1 + dx))
          wa.style.flex = `0 0 ${newW1}px`
          sp.style.flex = `0 0 ${total - newW1}px`
        }
        const onUp = () => {
          divider.classList.remove('dragging')
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })
    }
  }

  _openSplitView(url) {
    if (this.splitActive) {
      if (url) this.splitWV?.loadURL(this._resolveURL(url))
      return
    }
    this.splitActive = true

    const pane = this.$('split-pane')
    const divider = this.$('split-divider')
    const wrap = this.$('split-webview-wrap')
    const addr = this.$('split-addr')

    pane?.classList.remove('hidden')
    divider?.classList.remove('hidden')

    const wv = document.createElement('webview')
    wv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
    wv.src = this._resolveURL(url || 'lumen://newtab')
    wv.setAttribute('allowpopups', '')
    this.splitWV = wv

    wv.addEventListener('did-navigate', (e) => {
      if (addr) addr.value = e.url
    })
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (addr) addr.value = e.url
    })

    if (wrap) wrap.appendChild(wv)
    if (addr) addr.value = wv.src
  }

  _closeSplitView() {
    this.splitActive = false
    this.splitWV?.remove()
    this.splitWV = null
    this.$('split-pane')?.classList.add('hidden')
    this.$('split-divider')?.classList.add('hidden')
    // Reset flex
    this.$('webview-area').style.flex = ''
    this.$('split-pane') && (this.$('split-pane').style.flex = '')
  }

  _initHistory() {
    this.$('hist-close')?.addEventListener('click', () => this._closeHistory())
    this.$('hist-clear-btn')?.addEventListener('click', () => {
      localStorage.removeItem('lumen_history')
      localStorage.removeItem('lumen_visits')
      this._renderHistory()
      this._renderNTPSuggested()
      this._showToast('Histórico limpo', 'success')
    })
    this.$('hist-search')?.addEventListener('input', (e) => this._renderHistory(e.target.value))
  }

  _openHistory() {
    this.$('hist-panel')?.classList.remove('hidden')
    this._renderHistory()
    this.$('hist-search')?.focus()
  }

  _closeHistory() {
    this.$('hist-panel')?.classList.add('hidden')
  }

  _renderHistory(query = '') {
    const list = this.$('hist-list')
    if (!list) return
    let hist = JSON.parse(localStorage.getItem('lumen_history') || '[]')
    if (query) {
      const q = query.toLowerCase()
      hist = hist.filter(h => h.url?.toLowerCase().includes(q) || h.title?.toLowerCase().includes(q))
    }

    list.innerHTML = ''

    if (!hist.length) {
      const empty = document.createElement('div')
      empty.style.cssText = 'text-align:center;color:var(--text-3);font-size:13px;padding:40px 20px'
      empty.textContent = query ? 'Nenhum resultado' : 'Sem histórico ainda'
      list.appendChild(empty)
      return
    }

    // Group by day
    const groups = {}
    const today = new Date(); today.setHours(0,0,0,0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1)
    hist.forEach(h => {
      const d = new Date(h.ts); d.setHours(0,0,0,0)
      let label
      if (d.getTime() === today.getTime()) label = 'Hoje'
      else if (d.getTime() === yesterday.getTime()) label = 'Ontem'
      else label = d.toLocaleDateString(this._clockLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
      if (!groups[label]) groups[label] = []
      groups[label].push(h)
    })

    for (const [groupLabel, items] of Object.entries(groups)) {
      const gLabel = document.createElement('div')
      gLabel.className = 'hist-group-label'
      gLabel.textContent = groupLabel
      list.appendChild(gLabel)

      items.slice(0, 50).forEach(h => {
        const item = document.createElement('div')
        item.className = 'hist-item'
        try {
          const domain = new URL(h.url).hostname
          const img = document.createElement('img')
          img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
          img.onerror = () => img.remove()
          item.appendChild(img)
        } catch {}

        const info = document.createElement('div')
        info.className = 'hist-item-info'
        const titleEl = document.createElement('div')
        titleEl.className = 'hist-item-title'
        titleEl.textContent = h.title || h.url
        const urlEl = document.createElement('div')
        urlEl.className = 'hist-item-url'
        urlEl.textContent = h.url
        info.appendChild(titleEl)
        info.appendChild(urlEl)
        item.appendChild(info)

        item.addEventListener('click', () => {
          this.navigate(h.url)
          this._closeHistory()
        })
        list.appendChild(item)
      })
    }
  }

  _initDownloads() {
    this.downloads = new Map()

    this.$('dl-tray-close')?.addEventListener('click', () => {
      this.$('dl-tray')?.classList.add('hidden')
    })

    window.lumen?.onDlStart?.((d) => {
      this._dlAdd(d)
    })
    window.lumen?.onDlProgress?.((d) => {
      this._dlUpdate(d)
    })
    window.lumen?.onDlDone?.((d) => {
      this._dlFinish(d)
    })
  }

  _dlAdd({ id, filename, total }) {
    this.downloads.set(id, { filename, total, received: 0, state: 'active' })
    const tray = this.$('dl-tray')
    tray?.classList.remove('hidden')
    this._dlRender()
  }

  _dlUpdate({ id, received, total }) {
    const dl = this.downloads.get(id)
    if (!dl) return
    dl.received = received
    dl.total = total
    const item = document.getElementById(`dl-${id}`)
    if (!item) return
    const fill = item.querySelector('.dl-item-bar-fill')
    const meta = item.querySelector('.dl-item-meta')
    const pct = total > 0 ? Math.round(received / total * 100) : 0
    if (fill) fill.style.width = `${pct}%`
    if (meta) meta.textContent = `${this._fmtBytes(received)} / ${this._fmtBytes(total)} — ${pct}%`
  }

  _dlFinish({ id, state, savePath, filename }) {
    const dl = this.downloads.get(id)
    if (dl) dl.state = state
    const item = document.getElementById(`dl-${id}`)
    if (!item) return
    const bar = item.querySelector('.dl-item-bar')
    const meta = item.querySelector('.dl-item-meta')
    const fill = item.querySelector('.dl-item-bar-fill')
    if (state === 'completed') {
      if (fill) fill.style.width = '100%'
      if (bar) bar.style.background = 'var(--accent)'
      if (meta) meta.textContent = `Concluído — ${filename}`
      // Add "show in folder" action
      const actions = item.querySelector('.dl-item-actions')
      if (actions && savePath) {
        const showBtn = document.createElement('button')
        showBtn.className = 'dl-item-action'
        showBtn.title = 'Mostrar no Finder'
        showBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
        showBtn.addEventListener('click', () => window.lumen?.showItemInFolder?.(savePath))
        actions.appendChild(showBtn)
      }
    } else {
      if (meta) meta.textContent = 'Cancelado'
      if (bar) bar.style.opacity = '0.4'
    }
  }

  _dlRender() {
    const list = this.$('dl-list')
    if (!list) return
    list.innerHTML = ''
    for (const [id, dl] of [...this.downloads.entries()].reverse()) {
      const ext = dl.filename.split('.').pop()?.toLowerCase() || ''
      const icon = ['mp4','mkv','mov','avi'].includes(ext) ? '🎬'
        : ['mp3','flac','wav','ogg'].includes(ext) ? '🎵'
        : ['zip','gz','tar','rar','7z'].includes(ext) ? '📦'
        : ['pdf'].includes(ext) ? '📄'
        : ['jpg','jpeg','png','gif','webp'].includes(ext) ? '🖼️'
        : '📥'

      const pct = dl.total > 0 ? Math.round(dl.received / dl.total * 100) : 0
      const item = document.createElement('div')
      item.className = 'dl-item'
      item.id = `dl-${id}`
      item.innerHTML = `
        <div class="dl-item-icon">${icon}</div>
        <div class="dl-item-info">
          <div class="dl-item-name">${dl.filename}</div>
          <div class="dl-item-meta">${this._fmtBytes(dl.received)} / ${this._fmtBytes(dl.total)} — ${pct}%</div>
          <div class="dl-item-bar"><div class="dl-item-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="dl-item-actions"></div>
      `
      list.appendChild(item)
    }
  }

  _fmtBytes(n) {
    if (!n || n < 0) return '0 B'
    if (n < 1024) return `${n} B`
    if (n < 1048576) return `${(n/1024).toFixed(1)} KB`
    if (n < 1073741824) return `${(n/1048576).toFixed(1)} MB`
    return `${(n/1073741824).toFixed(2)} GB`
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

  _showToast(message, type = 'info', duration = 4000) {
    const icons = {
      success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
      error:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    }

    const existing = document.getElementById('lumen-toast')
    if (existing) {
      existing.style.animation = 'none'
      existing.offsetWidth
    }

    const toast = document.createElement('div')
    toast.id = 'lumen-toast'
    toast.className = `lumen-toast lumen-toast-${type}`
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-text">${message}</span>`
    if (existing) existing.replaceWith(toast)
    else document.body.appendChild(toast)

    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateY(4px)'
      setTimeout(() => toast.remove(), 200)
    }, duration)
  }

  _initPlatform() {
    // Sync early detection via navigator — ensures win-controls stays hidden on macOS
    // before the async IPC resolves
    const isMacSync = navigator.userAgent.includes('Macintosh') || navigator.platform?.startsWith('Mac')
    if (isMacSync) {
      document.body.classList.add('macos')
      this.$('win-controls')?.classList.add('hidden')
    }

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
    if (platform === 'darwin') {
      this.$('win-controls')?.classList.add('hidden')
    } else {
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
          case 'reader-mode': this._toggleReadingMode(); break
          case 'translate-text':
            if (text) {
              const turl = `https://translate.google.com/?sl=auto&tl=pt&text=${encodeURIComponent(text)}&op=translate`
              this.createTab({ url: turl })
            }
            break
          case 'translate-page': {
            const pageUrl = this._activeTab()?.url
            if (pageUrl) {
              const turl = `https://translate.google.com/translate?sl=auto&tl=pt&u=${encodeURIComponent(pageUrl)}`
              this._navigate(turl)
            }
            break
          }
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
    if (dir === 0) { tab.zoomFactor = 1; tab.webviewEl.setZoomFactor(1) }
    else {
      const next = Math.min(3, Math.max(0.25, current + dir * 0.1))
      tab.zoomFactor = next
      tab.webviewEl.setZoomFactor(next)
    }
    this._updateZoomIndicator(tab)
  }

  _updateZoomIndicator(tab) {
    let indicator = document.getElementById('zoom-indicator')
    const z = tab?.zoomFactor || 1
    const pct = Math.round(z * 100)

    if (pct === 100) {
      indicator?.remove()
      return
    }

    if (!indicator) {
      indicator = document.createElement('div')
      indicator.id = 'zoom-indicator'
      indicator.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:600;color:var(--text-3);pointer-events:none;user-select:none'
      document.getElementById('address-bar-wrap')?.appendChild(indicator)
    }

    indicator.textContent = `${pct}%`

    // Fade out after 2s if zoom not changed
    clearTimeout(this._zoomFadeTimer)
    indicator.style.opacity = '1'
    this._zoomFadeTimer = setTimeout(() => {
      if (indicator) indicator.style.opacity = '0.3'
    }, 2000)
  }

  _toggleTabMute(tab) {
    if (!tab?.webviewEl) return
    tab.muted = !tab.muted
    tab.webviewEl.setAudioMuted(tab.muted)
    this._updateTabMuteBtn(tab)
  }

  _updateTabMuteBtn(tab) {
    if (!tab?.tabEl) return
    const btn = tab.tabEl.querySelector('.tab-mute')
    if (!btn) return
    const playing = tab.hasMedia && !tab.muted
    const muted = tab.hasMedia && tab.muted
    btn.classList.toggle('hidden', !tab.hasMedia)
    btn.querySelector('.tab-mute-on').classList.toggle('hidden', muted)
    btn.querySelector('.tab-mute-off').classList.toggle('hidden', !muted)
    tab.tabEl.classList.toggle('tab-muted', muted)
    tab.tabEl.classList.toggle('tab-playing', playing)
  }

  _toggleReadingMode() {
    const wv = this._activeWV()
    const tab = this._activeTab()
    if (!wv || !tab) return

    if (tab._readingMode) {
      wv.reload()
      tab._readingMode = false
      return
    }

    tab._readingMode = true
    wv.executeJavaScript(`
      (function() {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        const title = document.title
        // Try article/main content
        const content =
          document.querySelector('article') ||
          document.querySelector('[role="main"]') ||
          document.querySelector('main') ||
          document.querySelector('.content') ||
          document.querySelector('#content') ||
          document.body

        const html = content.innerHTML
        const bg = isDark ? '#1c1c1e' : '#f9f9f9'
        const fg = isDark ? '#f0f0f0' : '#1a1a1a'
        const link = isDark ? '#6bb5ff' : '#0a66c2'

        document.documentElement.innerHTML = \`
          <!DOCTYPE html><html>
          <head>
            <meta charset="UTF-8">
            <title>\${title}</title>
            <style>
              *{box-sizing:border-box;margin:0;padding:0}
              body{background:\${bg};color:\${fg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:18px;line-height:1.7;padding:60px 24px 120px}
              .lumen-reader{max-width:700px;margin:0 auto}
              h1,h2,h3,h4{font-weight:700;margin:1.2em 0 .5em;line-height:1.3}
              h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}
              p{margin:.8em 0}
              a{color:\${link};text-decoration:none}a:hover{text-decoration:underline}
              img{max-width:100%;border-radius:8px;margin:1em 0}
              pre,code{background:rgba(128,128,128,.15);border-radius:6px;padding:.15em .4em;font-size:.9em;font-family:ui-monospace,monospace}
              pre{padding:1em;overflow-x:auto;line-height:1.5}
              blockquote{border-left:3px solid \${link};padding-left:1em;color:rgba(128,128,128,.9);font-style:italic;margin:1em 0}
              figure,figcaption{text-align:center;font-size:.85em;color:rgba(128,128,128,.8)}
              #lumen-exit{position:fixed;top:20px;right:24px;padding:8px 16px;background:\${link};color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;z-index:9999}
            </style>
          </head>
          <body>
            <button id="lumen-exit" onclick="history.back()">Sair do modo leitura</button>
            <div class="lumen-reader">\${html}</div>
          </body></html>
        \`
      })()
    `).catch(() => {})
  }

  _togglePiP() {
    const wv = this._activeWV()
    if (!wv) return
    wv.executeJavaScript(`
      (async () => {
        const videos = Array.from(document.querySelectorAll('video')).filter(v => !v.paused && v.readyState >= 2)
        if (!videos.length) return false
        const vid = videos.reduce((a, b) => a.videoWidth * a.videoHeight > b.videoWidth * b.videoHeight ? a : b)
        if (document.pictureInPictureElement === vid) {
          document.exitPictureInPicture()
        } else {
          await vid.requestPictureInPicture()
        }
        return true
      })()
    `).catch(() => {})
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

  _pulseAddressBar() {
    const inner = this.$('address-bar-inner')
    if (!inner) return
    inner.classList.remove('addr-pulse')
    void inner.offsetWidth
    inner.classList.add('addr-pulse')
    setTimeout(() => inner.classList.remove('addr-pulse'), 600)
  }

  _switchTab(dir) {
    if (this.tabs.length < 2) return
    const idx = this.tabs.findIndex(t => t.id === this.activeId)
    const next = this.tabs[(idx + dir + this.tabs.length) % this.tabs.length]
    this._activateTab(next.id)
  }

  _updateGreeting() {
    this._tickClock()
    setInterval(() => this._tickClock(), 1000)

    // Subtle parallax on NTP
    const ntp = this.$('ntp')
    const header = this.$('ntp-header')
    if (ntp && header) {
      ntp.addEventListener('mousemove', (e) => {
        if (!ntp.classList.contains('active')) return
        const cx = ntp.clientWidth / 2
        const cy = ntp.clientHeight / 2
        const dx = (e.clientX - cx) / cx
        const dy = (e.clientY - cy) / cy
        header.style.transform = `translate(${dx * -6}px, ${dy * -4}px)`
      })
      ntp.addEventListener('mouseleave', () => {
        header.style.transform = ''
      })
    }
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
    const h = now.getHours()
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

    // Time-of-day NTP background gradient (only if no custom bg set)
    const ntpEl = document.getElementById('ntp')
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
    if (ntpEl && !ntpEl.style.backgroundImage?.includes('url(')) {
      const grad = this._ntpGradient(h, isDark)
      ntpEl.style.background = grad
    }
  }

  _ntpGradient(h, dark) {
    if (dark) {
      if (h < 6)  return 'linear-gradient(160deg, #0a0a1a 0%, #0f0a20 60%, #0d0a0f 100%)'
      if (h < 9)  return 'linear-gradient(160deg, #0d1b2a 0%, #1a1040 60%, #0a0a1a 100%)'
      if (h < 12) return 'linear-gradient(160deg, #0f1c2e 0%, #162033 60%, #0f141a 100%)'
      if (h < 15) return 'linear-gradient(160deg, #111827 0%, #1c1c2e 100%)'
      if (h < 18) return 'linear-gradient(160deg, #141023 0%, #1a1530 100%)'
      if (h < 21) return 'linear-gradient(160deg, #1a0f1f 0%, #0d0d1a 60%, #0f0a0d 100%)'
      return 'linear-gradient(160deg, #0a0a14 0%, #0f0a1e 100%)'
    } else {
      if (h < 6)  return 'linear-gradient(160deg, #e8eaf6 0%, #c5cae9 100%)'
      if (h < 9)  return 'linear-gradient(160deg, #fff8e1 0%, #ffe0b2 100%)'
      if (h < 12) return 'linear-gradient(160deg, #e3f2fd 0%, #f3e5f5 100%)'
      if (h < 15) return 'linear-gradient(160deg, #f5f5f5 0%, #eeeeee 100%)'
      if (h < 18) return 'linear-gradient(160deg, #fce4ec 0%, #ede7f6 100%)'
      if (h < 21) return 'linear-gradient(160deg, #ffe0b2 0%, #ffccbc 100%)'
      return 'linear-gradient(160deg, #e8eaf6 0%, #c5cae9 100%)'
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
    else {
      document.documentElement.removeAttribute('data-theme')
      // Follow OS theme change live when on 'auto'
      if (!this._themeMediaWatcher) {
        this._themeMediaWatcher = window.matchMedia('(prefers-color-scheme: dark)')
        this._themeMediaWatcher.addEventListener('change', () => {
          this._tickClock()  // re-applies NTP gradient
        })
      }
    }
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
