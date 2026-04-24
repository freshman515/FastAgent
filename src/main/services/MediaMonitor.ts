import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { app } from 'electron'

export interface MediaInfo {
  title: string
  artist: string
  albumTitle: string
  albumArtist: string
  sourceAppId: string
  trackNumber: number | null
  status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
  artwork: string // base64 data URI or empty string
}

const POLL_INTERVAL = 2000

const MEDIA_PROBE_SOURCE = `
using System;
using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using Windows.Media.Control;

public static class Program {
  private static string Escape(string value) {
    if (value == null) return "";
    var sb = new StringBuilder(value.Length + 16);
    foreach (var ch in value) {
      switch (ch) {
        case '\\\\': sb.Append("\\\\\\\\"); break;
        case '"': sb.Append("\\\\u0022"); break;
        case '\\r': sb.Append("\\\\r"); break;
        case '\\n': sb.Append("\\\\n"); break;
        case '\\t': sb.Append("\\\\t"); break;
        default:
          if (ch < 32) sb.AppendFormat("\\\\u{0:X4}", (int)ch);
          else sb.Append(ch);
          break;
      }
    }
    return sb.ToString();
  }

  private static string MapStatus(GlobalSystemMediaTransportControlsSessionPlaybackStatus status) {
    switch (status) {
      case GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing: return "Playing";
      case GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused: return "Paused";
      case GlobalSystemMediaTransportControlsSessionPlaybackStatus.Stopped: return "Stopped";
      default: return "Unknown";
    }
  }

  public static int Main() {
    try {
      var manager = GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().GetAwaiter().GetResult();
      var session = manager.GetCurrentSession();
      if (session == null) {
        Console.Write("{\\"title\\":\\"\\",\\"artist\\":\\"\\",\\"albumTitle\\":\\"\\",\\"albumArtist\\":\\"\\",\\"sourceAppId\\":\\"\\",\\"trackNumber\\":null,\\"status\\":\\"Stopped\\",\\"artwork\\":\\"\\"}");
        return 0;
      }

      var props = session.TryGetMediaPropertiesAsync().AsTask().GetAwaiter().GetResult();
      var playbackInfo = session.GetPlaybackInfo();
      var status = playbackInfo != null ? MapStatus(playbackInfo.PlaybackStatus) : "Unknown";
      var albumTitle = props.AlbumTitle ?? "";
      var albumArtist = props.AlbumArtist ?? "";
      var sourceAppId = session.SourceAppUserModelId ?? "";
      var trackNumber = props.TrackNumber > 0 ? props.TrackNumber.ToString() : "null";
      var artwork = "";

      var thumb = props.Thumbnail;
      if (thumb != null) {
        using (var stream = thumb.OpenReadAsync().AsTask().GetAwaiter().GetResult())
        using (var input = stream.GetInputStreamAt(0))
        using (var managed = input.AsStreamForRead())
        using (var ms = new MemoryStream()) {
          managed.CopyTo(ms);
          var bytes = ms.ToArray();
          if (bytes.Length > 0 && bytes.Length <= 2 * 1024 * 1024) {
            var mime = stream.ContentType ?? "image/png";
            var comma = mime.IndexOf(',');
            if (comma >= 0) mime = mime.Substring(0, comma);
            artwork = "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
          }
        }
      }

      Console.Write(
        "{\\"title\\":\\"" + Escape(props.Title ?? "") +
        "\\",\\"artist\\":\\"" + Escape(props.Artist ?? "") +
        "\\",\\"albumTitle\\":\\"" + Escape(albumTitle) +
        "\\",\\"albumArtist\\":\\"" + Escape(albumArtist) +
        "\\",\\"sourceAppId\\":\\"" + Escape(sourceAppId) +
        "\\",\\"trackNumber\\":" + trackNumber +
        "\\",\\"status\\":\\"" + status +
        "\\",\\"artwork\\":\\"" + Escape(artwork) + "\\"}"
      );
      return 0;
    } catch (Exception ex) {
      Console.Error.WriteLine(ex.ToString());
      return 1;
    }
  }
}
`

const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]
const SYSTEM_RUNTIME_WINRT_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Runtime.WindowsRuntime.dll',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\System.Runtime.WindowsRuntime.dll',
]

function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/i, '').split('.').map((part) => Number(part) || 0)
  const right = b.replace(/^v/i, '').split('.').map((part) => Number(part) || 0)
  const max = Math.max(left.length, right.length)
  for (let i = 0; i < max; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function findExistingPath(paths: string[]): string | null {
  return paths.find((candidate) => existsSync(candidate)) ?? null
}

function findLatestWindowsWinMd(): string | null {
  const root = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'UnionMetadata')
  if (!existsSync(root)) return null
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => compareVersions(b, a))
  for (const version of versions) {
    const candidate = join(root, version, 'Windows.winmd')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function findLatestSystemRuntimeFacade(): string | null {
  const root = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Reference Assemblies', 'Microsoft', 'Framework', '.NETFramework')
  if (!existsSync(root)) return null
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => compareVersions(b, a))
  for (const version of versions) {
    const candidate = join(root, version, 'Facades', 'System.Runtime.dll')
    if (existsSync(candidate)) return candidate
  }
  return null
}

// PowerShell script to query Windows SystemMediaTransportControls
const PS_QUERY_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]

Function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $manager.GetCurrentSession()

if ($null -eq $session) {
  Write-Output '{"title":"","artist":"","albumTitle":"","albumArtist":"","sourceAppId":"","trackNumber":null,"status":"Stopped","artwork":""}'
  exit
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$playback = $session.GetPlaybackInfo()
$st = $playback.PlaybackStatus.ToString()
$albumTitle = if ($null -ne $props.AlbumTitle) { $props.AlbumTitle } else { "" }
$albumArtist = if ($null -ne $props.AlbumArtist) { $props.AlbumArtist } else { "" }
$sourceAppId = if ($null -ne $session.SourceAppUserModelId) { $session.SourceAppUserModelId } else { "" }
$trackNumber = if ($props.TrackNumber -gt 0) { [int]$props.TrackNumber } else { $null }

# Extract thumbnail as base64
$artwork = ""
try {
  $thumbRef = $props.Thumbnail
  if ($null -ne $thumbRef) {
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $stream = Await ($thumbRef.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = $stream.Size
    if ($size -gt 0 -and $size -lt 2097152) {
      $reader = New-Object Windows.Storage.Streams.DataReader($stream)
      $null = Await ($reader.LoadAsync([uint32]$size)) ([uint32])
      $bytes = New-Object byte[] $size
      $reader.ReadBytes($bytes)
      $reader.Dispose()
      $mimeType = ""
      try { $mimeType = $stream.ContentType } catch {}
      if ([string]::IsNullOrWhiteSpace($mimeType)) { $mimeType = "image/png" }
      $artwork = "data:" + $mimeType + ";base64," + [Convert]::ToBase64String($bytes)
    }
    $stream.Dispose()
  }
} catch {}

$obj = @{
  title = $props.Title
  artist = $props.Artist
  albumTitle = $albumTitle
  albumArtist = $albumArtist
  sourceAppId = $sourceAppId
  trackNumber = $trackNumber
  status = $st
  artwork = $artwork
}
$obj | ConvertTo-Json -Compress
`

// PowerShell script to send media key events
function mediaKeyScript(vk: number): string {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MK {
  [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Send(byte vk) {
    keybd_event(vk, 0, 1, UIntPtr.Zero);
    keybd_event(vk, 0, 3, UIntPtr.Zero);
  }
}
"@
[MK]::Send(${vk})
`
}

const VK_MEDIA_PLAY_PAUSE = 0xb3
const VK_MEDIA_NEXT_TRACK = 0xb0
const VK_MEDIA_PREV_TRACK = 0xb1

class MediaMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private last: MediaInfo = {
    title: '',
    artist: '',
    albumTitle: '',
    albumArtist: '',
    sourceAppId: '',
    trackNumber: null,
    status: 'Stopped',
    artwork: '',
  }
  private querying = false
  private probePath: string | null | undefined = undefined

  private isSameMediaInfo(a: MediaInfo, b: MediaInfo): boolean {
    return a.title === b.title
      && a.artist === b.artist
      && a.albumTitle === b.albumTitle
      && a.albumArtist === b.albumArtist
      && a.sourceAppId === b.sourceAppId
      && a.trackNumber === b.trackNumber
      && a.status === b.status
      && a.artwork === b.artwork
  }

  private getProbePath(): string | null {
    if (process.platform !== 'win32') return null
    if (this.probePath !== undefined) return this.probePath

    const cscPath = findExistingPath(CSC_CANDIDATES)
    const systemRuntimeWinRt = findExistingPath(SYSTEM_RUNTIME_WINRT_CANDIDATES)
    const systemRuntimeFacade = findLatestSystemRuntimeFacade()
    const windowsWinMd = findLatestWindowsWinMd()

    if (!cscPath || !systemRuntimeWinRt || !systemRuntimeFacade || !windowsWinMd) {
      this.probePath = null
      return null
    }

    try {
      const hash = createHash('sha256').update(MEDIA_PROBE_SOURCE).digest('hex').slice(0, 12)
      const binDir = join(app.getPath('userData'), 'bin')
      const exePath = join(binDir, `media-probe-${hash}.exe`)
      if (existsSync(exePath)) {
        this.probePath = exePath
        return exePath
      }

      mkdirSync(binDir, { recursive: true })
      const csPath = join(binDir, `media-probe-${hash}.cs`)
      writeFileSync(csPath, MEDIA_PROBE_SOURCE, 'utf8')

      execFileSync(
        cscPath,
        [
          '/nologo',
          '/target:exe',
          `/out:${exePath}`,
          `/reference:${systemRuntimeWinRt}`,
          `/reference:${systemRuntimeFacade}`,
          `/reference:${windowsWinMd}`,
          csPath,
        ],
        { windowsHide: true, stdio: 'ignore' },
      )

      if (!existsSync(exePath)) {
        this.probePath = null
        return null
      }

      this.probePath = exePath
      return exePath
    } catch (err) {
      console.error('[media] failed to prepare helper:', err)
      this.probePath = null
      return null
    }
  }

  private parseInfo(stdout: string): MediaInfo | null {
    try {
      return JSON.parse(stdout.trim()) as MediaInfo
    } catch {
      return null
    }
  }

  private applyInfo(info: MediaInfo | null): void {
    if (!info) return
    if (!this.isSameMediaInfo(info, this.last)) {
      this.last = info
      this.broadcast(info)
    }
  }

  private queryViaPowerShell(callback: (info: MediaInfo | null) => void): void {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY_SCRIPT], {
      timeout: 5000,
      windowsHide: true,
    }, (err, stdout) => {
      if (err) {
        callback(null)
        return
      }
      callback(this.parseInfo(stdout))
    })
  }

  start(): void {
    if (this.timer) return
    this.poll()
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private poll(): void {
    if (this.querying) return
    this.querying = true
    const probePath = this.getProbePath()

    const finish = (info: MediaInfo | null): void => {
      this.querying = false
      this.applyInfo(info)
    }

    if (!probePath) {
      this.queryViaPowerShell(finish)
      return
    }

    execFile(probePath, [], {
      timeout: 5000,
      windowsHide: true,
    }, (err, stdout) => {
      if (!err) {
        const info = this.parseInfo(stdout)
        if (info) {
          finish(info)
          return
        }
      }
      this.queryViaPowerShell(finish)
    })
  }

  private broadcast(info: MediaInfo): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('media:update', info)
      }
    }
  }

  getCurrent(): MediaInfo {
    return this.last
  }

  sendCommand(command: 'play-pause' | 'next' | 'prev'): void {
    const vk = command === 'play-pause' ? VK_MEDIA_PLAY_PAUSE
      : command === 'next' ? VK_MEDIA_NEXT_TRACK
      : VK_MEDIA_PREV_TRACK

    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', mediaKeyScript(vk)], {
      timeout: 3000,
      windowsHide: true,
    }, () => {
      // After sending key, poll immediately to get updated state
      setTimeout(() => this.poll(), 500)
    })
  }
}

export const mediaMonitor = new MediaMonitor()
