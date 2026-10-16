import type { BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

// Prints 1 while another window is full screen, 0 otherwise, twice a second.
// SHQueryUserNotificationState: 2 busy, 3 Direct3D full screen, 4 presentation mode.
// Windows reports 2 for some ordinary windows too (and while OBS runs), so 2 only counts when the foreground window
// covers its monitor. The desktop (Progman/WorkerW) always covers it, so it never counts.
// The focused pet counts as full screen when it covers the monitor (auto-hidden taskbar), hence the PET handle.
// A write to the closed pipe stops the script once the app is gone.
const FULLSCREEN_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Q -Name W -MemberDefinition '
public struct R { public int L, T, Rt, B; }
public struct M { public int Size; public R Mon, Work; public int Flags; }
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
[DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
[DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref M info);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
public static bool Covers(IntPtr h) {
  var c = new System.Text.StringBuilder(32); GetClassName(h, c, 32);
  if (c.ToString() == "Progman" || c.ToString() == "WorkerW") return false;
  R r; M m = new M(); m.Size = Marshal.SizeOf(m);
  if (!GetWindowRect(h, out r) || !GetMonitorInfo(MonitorFromWindow(h, 2), ref m)) return false;
  return r.L <= m.Mon.L && r.T <= m.Mon.T && r.Rt >= m.Mon.Rt && r.B >= m.Mon.B;
}'
while ($true) {
  $s = 0
  [void][Q.W]::SHQueryUserNotificationState([ref]$s)
  $f = [Q.W]::GetForegroundWindow()
  [Console]::WriteLine([int]($f -ne [IntPtr]PET -and ($s -eq 3 -or $s -eq 4 -or ($s -eq 2 -and [Q.W]::Covers($f)))))
  Start-Sleep -Milliseconds 500
}`

/** Windows keeps topmost windows above full-screen apps, so the pet hides itself while one is in front. */
export function watchFullscreen(win: BrowserWindow): () => void {
  const script = FULLSCREEN_PS.replace('PET', `${win.getNativeWindowHandle().readBigUInt64LE()}`)
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  })
  let full = false
  const lines = createInterface({ input: ps.stdout })
  ps.on('error', error => console.error('全屏检测服务启动失败：', error))
  lines.on('line', (line) => {
    if (win.isDestroyed()) return
    if ((line === '1') === full) return
    full = !full
    if (full) win.hide()
    else win.showInactive()
  })
  const stop = (): void => { lines.close(); ps.kill() }
  win.once('closed', stop)
  return stop
}
