'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

contextBridge.exposeInMainWorld('splitcord', {
  // Discord webview'inin kendi preload'unu (getDisplayMedia kalite/FPS enjeksiyonu için)
  // dinamik olarak yükleyebilmesi için dosya yolu — renderer'ın Node erişimi olmadığı
  // için bu yolu burada (preload, Node erişimine sahip) hesaplayıp veriyoruz.
  paths: {
    discordWebviewPreload: pathToFileURL(path.join(__dirname, 'discordWebviewPreload.js')).href,
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    openSettings: (panel, highlight) => ipcRenderer.send('window:open-settings', panel, highlight),
    closeSettings: () => ipcRenderer.send('settings-window:close'),
    setDirty: (dirty) => ipcRenderer.send('settings-window:set-dirty', dirty),
    openDiscordLink: (url) => ipcRenderer.invoke('window:open-discord-link', url),
  },
  dpi: {
    getStatus: () => ipcRenderer.invoke('dpi:get-status'),
    activateEngine: (id) => ipcRenderer.invoke('dpi:activate-engine', id),
    setArgs: (id, args, options) => ipcRenderer.invoke('dpi:set-args', id, args, options),
    getLogs: (id) => ipcRenderer.invoke('dpi:get-logs', id),
    reportByeDpiFailure: () => ipcRenderer.invoke('dpi:report-byedpi-failure'),
    reportEngineFailure: (id) => ipcRenderer.invoke('dpi:report-engine-failure', id),
    getDohProviders: () => ipcRenderer.invoke('dpi:get-doh-providers'),
    setDohProviders: (providers) => ipcRenderer.invoke('dpi:set-doh-providers', providers),
    getMode: () => ipcRenderer.invoke('dpi:get-mode'),
    setMode: (mode) => ipcRenderer.invoke('dpi:set-mode', mode),
    cancelScan: () => ipcRenderer.invoke('dpi:cancel-scan'),
    stopAllEngines: () => ipcRenderer.invoke('dpi:stop-all'),
    getRejectedArgs: (id) => ipcRenderer.invoke('dpi:get-rejected-args', id),
    rejectCurrentArgs: (id) => ipcRenderer.invoke('dpi:reject-current-args', id),
    unrejectArgs: (id, args) => ipcRenderer.invoke('dpi:unreject-args', id, args),
    getByeDpiUseExtendedCandidates: () => ipcRenderer.invoke('dpi:get-byedpi-use-extended-candidates'),
    setByeDpiUseExtendedCandidates: (enabled) => ipcRenderer.invoke('dpi:set-byedpi-use-extended-candidates', enabled),
    getFirewallStatus: () => ipcRenderer.invoke('dpi:get-firewall-status'),
    grantFirewallPermission: () => ipcRenderer.invoke('dpi:grant-firewall-permission'),
    getAppFirewallStatus: () => ipcRenderer.invoke('dpi:get-app-firewall-status'),
    grantAppFirewallPermission: () => ipcRenderer.invoke('dpi:grant-app-firewall-permission'),
    getSystemControlsStatus: () => ipcRenderer.invoke('dpi:get-system-controls-status'),
    killProcess: (pid) => ipcRenderer.invoke('dpi:kill-process', pid),
    removeConflictingService: (serviceName) => ipcRenderer.invoke('dpi:remove-conflicting-service', serviceName),
  },
  app: {
    getAutoStart: () => ipcRenderer.invoke('app:get-autostart'),
    setAutoStart: (enabled) => ipcRenderer.invoke('app:set-autostart', enabled),
    getStartInBackground: () => ipcRenderer.invoke('app:get-start-in-background'),
    setStartInBackground: (enabled) => ipcRenderer.invoke('app:set-start-in-background', enabled),
    getGpuAcceleration: () => ipcRenderer.invoke('app:get-gpu-acceleration'),
    setGpuAcceleration: (enabled) => ipcRenderer.invoke('app:set-gpu-acceleration', enabled),
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getThemeMode: () => ipcRenderer.invoke('app:get-theme-mode'),
    setThemeMode: (mode) => ipcRenderer.invoke('app:set-theme-mode', mode),
    getOpenLinksExternally: () => ipcRenderer.invoke('app:get-open-links-externally'),
    setOpenLinksExternally: (enabled) => ipcRenderer.invoke('app:set-open-links-externally', enabled),
    getLinkOpenerNewWindow: () => ipcRenderer.invoke('app:get-link-opener-new-window'),
    setLinkOpenerNewWindow: (enabled) => ipcRenderer.invoke('app:set-link-opener-new-window', enabled),
    getPerformanceMode: () => ipcRenderer.invoke('app:get-performance-mode'),
    setPerformanceMode: (enabled) => ipcRenderer.invoke('app:set-performance-mode', enabled),
    getProtocolHandlerStatus: () => ipcRenderer.invoke('app:get-protocol-handler-status'),
    getControlsIssueStatus: () => ipcRenderer.invoke('app:get-controls-issue-status'),
    getIgnoredControlIssues: () => ipcRenderer.invoke('app:get-ignored-control-issues'),
    setControlIssueIgnored: (issueId, ignored) => ipcRenderer.invoke('app:set-control-issue-ignored', issueId, ignored),
    uninstallOfficialDiscord: () => ipcRenderer.invoke('app:uninstall-official-discord'),
    openDefaultAppsSettings: () => ipcRenderer.invoke('app:open-default-apps-settings'),
    checkForUpdate: () => ipcRenderer.invoke('app:check-for-update'),
    downloadUpdate: (downloadUrl) => ipcRenderer.invoke('app:download-update', downloadUrl),
    openDownloadedUpdate: () => ipcRenderer.invoke('app:open-downloaded-update'),
    getShortcuts: () => ipcRenderer.invoke('app:get-shortcuts'),
    setShortcutsEnabled: (enabled) => ipcRenderer.invoke('app:set-shortcuts-enabled', enabled),
    setShortcutBinding: (action, accelerator) => ipcRenderer.invoke('app:set-shortcut-binding', action, accelerator),
    getNotificationBadgeEnabled: () => ipcRenderer.invoke('app:get-notification-badge-enabled'),
    setNotificationBadgeEnabled: (enabled) => ipcRenderer.invoke('app:set-notification-badge-enabled', enabled),
    getDisableFalseVoiceWarning: () => ipcRenderer.invoke('app:get-disable-false-voice-warning'),
    setDisableFalseVoiceWarning: (enabled) => ipcRenderer.invoke('app:set-disable-false-voice-warning', enabled),
    resetAllSettings: () => ipcRenderer.invoke('app:reset-all-settings'),
    registerBadgedTrayIcon: (dataUrl) => ipcRenderer.invoke('tray:register-badged-icon', dataUrl),
    registerNotificationOverlayIcon: (dataUrl) => ipcRenderer.invoke('window:register-notification-overlay-icon', dataUrl),
  },
  voice: {
    getState: () => ipcRenderer.invoke('voice:get-state'),
    pollNow: () => ipcRenderer.invoke('voice:poll-now'),
  },
  onVoiceStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('voice:state-changed', listener);
    return () => ipcRenderer.removeListener('voice:state-changed', listener);
  },
  onNotificationCountChanged: (callback) => {
    const listener = (_event, count) => callback(count);
    ipcRenderer.on('notification-badge:count-changed', listener);
    return () => ipcRenderer.removeListener('notification-badge:count-changed', listener);
  },
  log: (tag, data) => ipcRenderer.send('renderer:log-event', tag, data),
  onShowConfirmModal: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('modal:show-confirm', listener);
    return () => ipcRenderer.removeListener('modal:show-confirm', listener);
  },
  sendConfirmModalResult: (id, choice) => ipcRenderer.send('modal:confirm-result', id, choice),
  onDpiEngineChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('dpi:engine-changed', listener);
    return () => ipcRenderer.removeListener('dpi:engine-changed', listener);
  },
  onControlsIssueStatusChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:controls-issue-status-changed', listener);
    return () => ipcRenderer.removeListener('app:controls-issue-status-changed', listener);
  },
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('app:update-available', listener);
    return () => ipcRenderer.removeListener('app:update-available', listener);
  },
  onNavigateToDiscordUrl: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('app:navigate-to-discord-url', listener);
    return () => ipcRenderer.removeListener('app:navigate-to-discord-url', listener);
  },
  onSettingsNavigate: (callback) => {
    const listener = (_event, panel, highlight) => callback(panel, highlight);
    ipcRenderer.on('settings-window:navigate', listener);
    return () => ipcRenderer.removeListener('settings-window:navigate', listener);
  },
  onPerformanceModeChanged: (callback) => {
    const listener = (_event, enabled) => callback(enabled);
    ipcRenderer.on('app:performance-mode-changed', listener);
    return () => ipcRenderer.removeListener('app:performance-mode-changed', listener);
  },
  onDynamicColorSampled: (callback) => {
    const listener = (_event, colors) => callback(colors);
    ipcRenderer.on('app:dynamic-color-sampled', listener);
    return () => ipcRenderer.removeListener('app:dynamic-color-sampled', listener);
  },
});
