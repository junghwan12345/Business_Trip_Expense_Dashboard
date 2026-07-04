param(
  [string]$Title = "",
  [string]$OkLabel = "",
  [string]$InitialPath = "",
  [switch]$WarmupOnly
)

# NOTE: This file intentionally contains NO non-ASCII characters. Windows
# PowerShell 5.1 reads .ps1 files as the ANSI code page (CP949 on Korean
# Windows) unless they carry a UTF-8 BOM, which would corrupt any Korean
# literal. All user-facing Korean text is passed in via -Title / -OkLabel.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Best-effort: ask Windows for Korean dialog chrome. Only works when the OS
# has the Korean language resources installed; otherwise the OS display
# language wins and the buttons stay in that language.
try {
  $ko = New-Object System.Globalization.CultureInfo("ko-KR")
  [System.Threading.Thread]::CurrentThread.CurrentUICulture = $ko
  [System.Threading.Thread]::CurrentThread.CurrentCulture = $ko
} catch { }

# Compile the COM interop + foreground helper once, then cache the assembly
# to TEMP so later clicks load it instantly instead of recompiling.
$helperSource = @"
using System;
using System.Runtime.InteropServices;

public static class ForegroundHelper {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}

public static class ModernFolderPicker {
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
  }

  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
  private class FileOpenDialogRCW { }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  private static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem ppv);

  const uint FOS_PICKFOLDERS = 0x20;
  const uint FOS_FORCEFILESYSTEM = 0x40;
  const uint SIGDN_FILESYSPATH = 0x80058000;

  public static string Pick(string title, string okLabel, string initialPath, IntPtr owner) {
    IFileDialog dialog = (IFileDialog)(new FileOpenDialogRCW());
    uint opts;
    dialog.GetOptions(out opts);
    dialog.SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
    if (!string.IsNullOrEmpty(okLabel)) dialog.SetOkButtonLabel(okLabel);
    if (!string.IsNullOrEmpty(initialPath)) {
      try {
        Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
        IShellItem item;
        if (SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref iid, out item) == 0 && item != null) {
          dialog.SetFolder(item);
        }
      } catch { }
    }
    int hr = dialog.Show(owner);
    if (hr != 0) return null;
    IShellItem result;
    dialog.GetResult(out result);
    IntPtr pszPath;
    result.GetDisplayName(SIGDN_FILESYSPATH, out pszPath);
    string path = Marshal.PtrToStringUni(pszPath);
    Marshal.FreeCoTaskMem(pszPath);
    return path;
  }
}
"@

$cacheDll = Join-Path $env:TEMP "travel-proof-folderpicker.dll"
$loaded = $false
if (Test-Path $cacheDll) {
  try { Add-Type -Path $cacheDll; $loaded = $true } catch { $loaded = $false }
}
if (-not $loaded) {
  try {
    Add-Type -TypeDefinition $helperSource -OutputAssembly $cacheDll
    Add-Type -Path $cacheDll
  } catch {
    # Fall back to loading straight into the session without caching.
    Add-Type -TypeDefinition $helperSource
  }
}

# Warmup mode: the server calls this at startup only to pre-build the cached
# assembly, so the first real folder pick is already fast. No dialog shown.
if ($WarmupOnly) {
  [Console]::Out.Write("warmup-ok")
  return
}

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null

# Invisible topmost owner so the dialog is guaranteed to appear in front.
$owner = New-Object System.Windows.Forms.Form
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
[ForegroundHelper]::ShowWindow($owner.Handle, 5) | Out-Null
[ForegroundHelper]::BringWindowToTop($owner.Handle) | Out-Null
[ForegroundHelper]::SetForegroundWindow($owner.Handle) | Out-Null

$selected = $null
try {
  $selected = [ModernFolderPicker]::Pick($Title, $OkLabel, $InitialPath, $owner.Handle)
} catch {
  # Fall back to the classic dialog if the modern picker is unavailable.
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  if ($Title) { $dialog.Description = $Title }
  $dialog.ShowNewFolderButton = $true
  if ($InitialPath -and (Test-Path $InitialPath)) { $dialog.SelectedPath = $InitialPath }
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $selected = $dialog.SelectedPath }
}
$owner.Close()

if ($selected) {
  [Console]::Out.Write($selected)
}
