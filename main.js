const { app, BrowserWindow, ipcMain, session, nativeTheme, shell, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync } = require('child_process')

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

// Spoof Chrome UA so Chrome Web Store works (no "Switch to Chrome" banner)
const CHROME_UA = isMac
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Auto-updater ──────────────────────────────────────────────────────────
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-downloaded', () => {
  // Notify renderer that update is ready
  mainWin?.webContents.send('update-ready')
})

// ─── Ad / Tracker blocklist ────────────────────────────────────────────────
const AD_URLS = [
  '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*',
  '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*',
  '*://*.amazon-adsystem.com/*', '*://*.moatads.com/*',
  '*://*.outbrain.com/*',         '*://*.taboola.com/*',
  '*://*.scorecardresearch.com/*','*://*.quantserve.com/*',
  '*://*.chartbeat.com/*',        '*://*.advertising.com/*',
  '*://*.criteo.com/*',           '*://*.pubmatic.com/*',
  '*://*.rubiconproject.com/*',   '*://*.openx.net/*',
  '*://*.adnxs.com/*',            '*://*.adsrvr.org/*',
  '*://*.casalemedia.com/*',      '*://*.media.net/*',
  '*://*.yieldmanager.com/*',     '*://*.rlcdn.com/*',
  '*://*.adroll.com/*',           '*://*.hotjar.com/*',
  '*://*.mouseflow.com/*',        '*://*.mixpanel.com/*',
  '*://*.segment.io/*',           '*://*.segment.com/analytics.js',
  '*://*.fullstory.com/*',        '*://*.loggly.com/*',
  '*://*.newrelic.com/*',         '*://*.nr-data.net/*',
  '*://*.facebook.com/tr*',       '*://*.connect.facebook.net/*/fbevents.js',
  '*://*.ads.twitter.com/*',      '*://*.static.ads-twitter.com/*',
  '*://*.linkedin.com/li.lms*',   '*://*.snap.licdn.com/*',
  '*://*.tiktok.com/i18n/pixel*', '*://*.analytics.tiktok.com/*',
]

let mainWin = null
let blockedCount = 0

// ─── CRX Extension Installer ──────────────────────────────────────────────
function setupExtInstaller(ses) {
  ses.on('will-download', (event, item) => {
    const url = item.getURL()
    const mime = item.getMimeType()
    const isCrx = url.includes('clients2.google.com') ||
                  mime === 'application/x-chrome-extension' ||
                  url.includes('.crx') ||
                  (url.includes('chromewebstore.google.com') && url.includes('crx'))

    if (!isCrx) return

    const tmpCrx = path.join(os.tmpdir(), `lumen-ext-${Date.now()}.crx`)
    item.setSavePath(tmpCrx)

    item.on('done', async (e, state) => {
      if (state !== 'completed') return
      try {
        // CRX3 format: find ZIP start (PK\x03\x04 magic)
        const buf = fs.readFileSync(tmpCrx)
        let zipStart = -1
        for (let i = 0; i < buf.length - 4; i++) {
          if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x03 && buf[i+3] === 0x04) {
            zipStart = i; break
          }
        }
        if (zipStart === -1) throw new Error('Formato CRX inválido')

        const zipFile = tmpCrx + '.zip'
        fs.writeFileSync(zipFile, buf.slice(zipStart))

        // Save to permanent extensions dir (persists across restarts)
        const extDir = path.join(app.getPath('userData'), 'extensions', `crx-${Date.now()}`)
        fs.mkdirSync(extDir, { recursive: true })

        if (isWin) {
          execSync(`powershell -command "Expand-Archive -Path '${zipFile}' -DestinationPath '${extDir}' -Force"`)
        } else {
          execSync(`unzip -o "${zipFile}" -d "${extDir}"`)
        }

        const ext = await session.defaultSession.loadExtension(extDir, { allowFileAccess: true })
        addExtPath(extDir)
        mainWin?.webContents.send('ext-installed', { name: ext.manifest.name, id: ext.id })

        try { fs.unlinkSync(tmpCrx); fs.unlinkSync(zipFile) } catch {}
      } catch (err) {
        mainWin?.webContents.send('ext-install-error', err.message)
        try { fs.unlinkSync(tmpCrx) } catch {}
      }
    })
  })
}

function setupAdBlocker(ses) {
  ses.webRequest.onBeforeRequest({ urls: AD_URLS }, (details, cb) => {
    blockedCount++
    mainWin?.webContents.send('ad-blocked', blockedCount)
    cb({ cancel: true })
  })

  // Force HTTPS upgrades
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*'] }, (details, cb) => {
    const url = details.url.replace(/^http:\/\//, 'https://')
    cb({ redirectURL: url })
  })
}

// ─── Extension Persistence ────────────────────────────────────────────────
function extListPath() {
  return path.join(app.getPath('userData'), 'installed-extensions.json')
}

function loadExtPaths() {
  try { return JSON.parse(fs.readFileSync(extListPath(), 'utf8')) } catch { return [] }
}

function saveExtPaths(paths) {
  try { fs.writeFileSync(extListPath(), JSON.stringify(paths)) } catch {}
}

function addExtPath(extPath) {
  const paths = loadExtPaths()
  if (!paths.includes(extPath)) { paths.push(extPath); saveExtPaths(paths) }
}

function removeExtPath(extPath) {
  const paths = loadExtPaths().filter(p => p !== extPath)
  saveExtPaths(paths)
}

async function restoreExtensions(ses) {
  const paths = loadExtPaths()
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try { await ses.loadExtension(p, { allowFileAccess: true }) } catch {}
    } else {
      removeExtPath(p)
    }
  }
}

function createWindow() {
  const winOptions = {
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1C1C1E',
    icon: path.join(__dirname, 'assets/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  }

  if (isMac) {
    winOptions.titleBarStyle = 'hiddenInset'
    winOptions.trafficLightPosition = { x: 16, y: 18 }
    winOptions.vibrancy = 'under-window'
    winOptions.visualEffectState = 'active'
  } else if (isWin) {
    winOptions.frame = false
    winOptions.backgroundMaterial = 'acrylic'
  } else {
    winOptions.frame = false
  }

  mainWin = new BrowserWindow(winOptions)

  session.defaultSession.setUserAgent(CHROME_UA)
  setupAdBlocker(session.defaultSession)
  setupExtInstaller(session.defaultSession)
  restoreExtensions(session.defaultSession)
  mainWin.loadFile(path.join(__dirname, 'src/index.html'))

  if (process.argv.includes('--dev')) {
    mainWin.webContents.openDevTools({ mode: 'detach' })
  }

  // Send platform info to renderer
  mainWin.webContents.on('did-finish-load', () => {
    mainWin.webContents.send('platform', process.platform)
  })

  // Sync maximize state to renderer
  mainWin.on('maximize', () => mainWin.webContents.send('win-maximized', true))
  mainWin.on('unmaximize', () => mainWin.webContents.send('win-maximized', false))
}

app.whenReady().then(() => {
  createWindow()
  // Check for updates 5s after launch (not in dev mode)
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates(), 5000)
    // Re-check every 6 hours
    setInterval(() => autoUpdater.checkForUpdates(), 6 * 60 * 60 * 1000)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ─── IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('app-version', () => app.getVersion())
ipcMain.handle('is-dark-mode', () => nativeTheme.shouldUseDarkColors)
ipcMain.handle('get-platform', () => process.platform)
ipcMain.on('install-update', () => autoUpdater.quitAndInstall())

// Window controls (used on Windows/Linux with frame:false)
ipcMain.on('win-minimize', () => mainWin?.minimize())
ipcMain.on('win-maximize', () => mainWin?.isMaximized() ? mainWin.unmaximize() : mainWin.maximize())
ipcMain.on('win-close', () => mainWin?.close())

ipcMain.on('open-external', (_, url) => shell.openExternal(url))

// Incognito sessions: one partition per incognito window
ipcMain.handle('create-incognito-session', (_, id) => {
  const ses = session.fromPartition(`incognito-${id}`, { cache: false })
  setupAdBlocker(ses)
  return id
})

// ─── Background image picker ───────────────────────────────────────────────
ipcMain.handle('pick-bg-image', async () => {
  const result = await dialog.showOpenDialog(mainWin, {
    title: 'Escolher imagem de fundo',
    filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

// ─── Chrome Extensions ─────────────────────────────────────────────────────
ipcMain.handle('load-extension-folder', async () => {
  const result = await dialog.showOpenDialog(mainWin, {
    title: 'Selecionar pasta da extensão',
    properties: ['openDirectory'],
    buttonLabel: 'Carregar'
  })
  if (result.canceled || !result.filePaths.length) return null
  try {
    const extPath = result.filePaths[0]
    const ext = await session.defaultSession.loadExtension(extPath, { allowFileAccess: true })
    addExtPath(extPath)
    return { id: ext.id, name: ext.manifest.name, description: ext.manifest.description || '', version: ext.manifest.version, path: extPath }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('get-extensions', () => {
  return session.defaultSession.getAllExtensions().map(ext => ({
    id: ext.id, name: ext.manifest.name, description: ext.manifest.description || '', version: ext.manifest.version,
    path: ext.path
  }))
})

ipcMain.handle('remove-extension', (_, id) => {
  try {
    const ext = session.defaultSession.getAllExtensions().find(e => e.id === id)
    if (ext) removeExtPath(ext.path)
    session.defaultSession.removeExtension(id)
    return true
  } catch (e) { return false }
})

// Chrome extensions path helper
function getChromeExtPath() {
  const home = os.homedir()
  if (isMac)  return path.join(home, 'Library/Application Support/Google/Chrome/Default/Extensions')
  if (isWin)  return path.join(home, 'AppData/Local/Google/Chrome/User Data/Default/Extensions')
  return path.join(home, '.config/google-chrome/Default/Extensions')
}
ipcMain.handle('get-chrome-ext-path', () => getChromeExtPath())
