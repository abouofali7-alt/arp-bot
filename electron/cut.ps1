param(
    [Parameter(Mandatory = $true)]
    [string]$PrinterName,
    [int]$FeedLines = 1,
    [int]$MaxWaitSeconds = 8
)

# 1) wait for the printer queue to drain so the cut lands AFTER the receipt finishes
$deadline = (Get-Date).AddSeconds($MaxWaitSeconds)
while ((Get-Date) -lt $deadline) {
    $jobs = @(Get-CimInstance Win32_PrintJob -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$PrinterName*,*" })
    if ($jobs.Count -eq 0) { break }
    Start-Sleep -Milliseconds 400
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawCutPrn {
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, IntPtr di);
    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytes(string szPrinterName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero)) return false;
        bool ok = false;
        IntPtr docName = Marshal.StringToCoTaskMemAnsi("Paper Cut");
        IntPtr dataType = Marshal.StringToCoTaskMemAnsi("RAW");
        IntPtr di = Marshal.AllocCoTaskMem(IntPtr.Size * 3);
        Marshal.WriteIntPtr(di, 0, docName);
        Marshal.WriteIntPtr(di, IntPtr.Size, IntPtr.Zero);
        Marshal.WriteIntPtr(di, IntPtr.Size * 2, dataType);
        try {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
                    int dwWritten;
                    ok = WritePrinter(hPrinter, pUnmanaged, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanaged);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
        } finally {
            Marshal.FreeCoTaskMem(docName);
            Marshal.FreeCoTaskMem(dataType);
            Marshal.FreeCoTaskMem(di);
            ClosePrinter(hPrinter);
        }
        return ok;
    }
}
"@

# ESC d <n>  = feed n lines clear of the blade, then GS V 'A' 0 = full cut
$n = [Math]::Max(1, $FeedLines)
$bytes = New-Object System.Collections.Generic.List[byte]
$bytes.Add(27); $bytes.Add(100); $bytes.Add([byte]$n)
foreach ($b in @(29, 86, 65, 0)) { $bytes.Add([byte]$b) }

$ok = $false
try { $ok = [RawCutPrn]::SendBytes($PrinterName, $bytes.ToArray()) } catch { Write-Output ("ERR: " + $_.Exception.Message) }

# fallback: older firmwares that only honour the simple form GS V 0
if (-not $ok) {
    try { $ok = [RawCutPrn]::SendBytes($PrinterName, [byte[]](27, 100, [byte]$n, 29, 86, 0)) } catch { }
}

if ($ok) { Write-Output 'CUT OK' } else { Write-Output 'CUT FAIL' }
