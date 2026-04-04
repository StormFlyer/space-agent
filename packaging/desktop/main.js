const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { createAgentServer } = require("../../server/app");

let serverRuntime;
let mainWindow;
let isQuitting = false;

function createDesktopRuntimeParamOverrides() {
  if (!app.isPackaged) {
    return {};
  }

  return {
    SINGLE_USER_APP: "true"
  };
}

function resolveDesktopLaunchPath() {
  return serverRuntime?.runtimeParams?.get?.("SINGLE_USER_APP", false) ? "/enter" : "/";
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f2efe8",
    title: "Space Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("close", (event) => {
    // On macOS, Cmd+W should hide the app and preserve renderer state.
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://${serverRuntime.host}:${serverRuntime.port}${resolveDesktopLaunchPath()}`);
  return mainWindow;
}

function stopServerRuntime() {
  if (!serverRuntime) {
    return;
  }

  const runtime = serverRuntime;
  serverRuntime = null;

  if (runtime.watchdog && typeof runtime.watchdog.stop === "function") {
    runtime.watchdog.stop();
  }

  if (runtime.server && runtime.server.listening) {
    runtime.server.close();
  }
}

async function startDesktop() {
  serverRuntime = await createAgentServer({
    host: "127.0.0.1",
    port: Number(process.env.PORT || 3000),
    runtimeParamOverrides: createDesktopRuntimeParamOverrides()
  });

  await serverRuntime.listen();
  await app.whenReady();
  createWindow();

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServerRuntime();
});

startDesktop().catch((error) => {
  console.error("Failed to start desktop harness.");
  console.error(error);
  app.quit();
});
