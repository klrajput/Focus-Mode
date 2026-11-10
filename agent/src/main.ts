// T-001 placeholder — minimal Electron main process, replaced by owner A7 in W1.
// It exists so the Focus Agent window opens before tray/pairing/focus code lands.

import { app, BrowserWindow } from 'electron';

const SCAFFOLD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'"
    />
    <title>Focus Agent — scaffold</title>
  </head>
  <body style="margin:0;font-family:system-ui;background:#1E1B4B;color:#F8FAFC">
    <main style="padding:24px">
      <h1 style="margin:0 0 8px;font-size:20px">Focus Agent — scaffold</h1>
      <p style="margin:0;font-size:13px;color:#cbd5e1">
        T-001 placeholder window. Pairing code, tray menu and focus drivers land in W1.
      </p>
    </main>
  </body>
</html>`;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 440,
    height: 260,
    title: 'Focus Agent — scaffold',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SCAFFOLD_HTML)}`);
}

void app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
