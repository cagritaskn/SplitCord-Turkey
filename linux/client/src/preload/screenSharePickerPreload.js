'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splitcordPicker', {
  onSources: (callback) => {
    ipcRenderer.on('screen-share-picker:sources', (_event, sources) => callback(sources));
  },
  choose: (id) => ipcRenderer.send('screen-share-picker:choose', id),
  cancel: () => ipcRenderer.send('screen-share-picker:cancel'),
  onDynamicColorSampled: (callback) => {
    ipcRenderer.on('app:dynamic-color-sampled', (_event, palette) => callback(palette));
  },
});
