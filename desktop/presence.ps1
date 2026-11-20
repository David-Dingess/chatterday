# Looks every 5 seconds at the window in front and prints one line when it has changed (and once at the start):
# "<exe path><TAB><window title><TAB><product name><TAB><process id><TAB><window class><TAB><left,top,right,bottom>".
# (The class and the rectangle, in screen pixels, are for the admin's "stay on top of this screen": the app gets out
# of the way of a window put on its monitor on purpose, and not of the taskbar or the desktop.)
# The desktop app reads these lines and turns them into a single word (gaming, watching, ...).
# Nothing here is sent anywhere; the title and path stay on this PC.
param([int]$ParentPid = 0)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FcWin {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder s, ref uint n);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  static string Clean(string s) { return (s ?? "").Replace("\t", " ").Replace("\r", " ").Replace("\n", " "); }
  static string lastPath = "", lastProduct = "";
  public static string Snapshot() {
    IntPtr w = GetForegroundWindow();
    if (w == IntPtr.Zero) return "\t\t\t\t\t";
    uint pid;
    GetWindowThreadProcessId(w, out pid);
    StringBuilder title = new StringBuilder(512);
    GetWindowText(w, title, 512);
    string path = "";
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION: works for elevated games too
    if (h != IntPtr.Zero) {
      StringBuilder p = new StringBuilder(1024);
      uint n = 1024;
      if (QueryFullProcessImageName(h, 0, p, ref n)) path = p.ToString();
      CloseHandle(h);
    }
    if (path != lastPath) {   // the product name is read out of the program's file: once per program, not every 5 seconds
      lastPath = path;
      lastProduct = "";
      try { if (path != "") lastProduct = System.Diagnostics.FileVersionInfo.GetVersionInfo(path).ProductName; } catch { }
    }
    StringBuilder cls = new StringBuilder(128);
    GetClassName(w, cls, 128);
    RECT r;
    string rect = GetWindowRect(w, out r) ? r.L + "," + r.T + "," + r.R + "," + r.B : "";
    return Clean(path) + "\t" + Clean(title.ToString()) + "\t" + Clean(lastProduct) + "\t" + pid + "\t" + Clean(cls.ToString()) + "\t" + rect;
  }
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$last = $null
while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid)) { break }
  $now = [FcWin]::Snapshot()
  if ($now -cne $last) {
    $last = $now
    [Console]::Out.WriteLine($now)
    [Console]::Out.Flush()
  }
  Start-Sleep -Seconds 5
}
