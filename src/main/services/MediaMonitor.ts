import { execFile } from 'node:child_process'
import { BrowserWindow } from 'electron'

export interface MediaInfo {
  title: string
  artist: string
  status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown'
  artwork: string // base64 data URI or empty string
}

const POLL_INTERVAL = 2000

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
  Write-Output '{"title":"","artist":"","status":"Stopped","artwork":""}'
  exit
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$playback = $session.GetPlaybackInfo()
$st = $playback.PlaybackStatus.ToString()

# Extract thumbnail as base64
$artwork = ""
try {
  $thumbRef = $props.Thumbnail
  if ($null -ne $thumbRef) {
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $stream = Await ($thumbRef.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = $stream.Size
    if ($size -gt 0 -and $size -lt 500000) {
      $reader = New-Object Windows.Storage.Streams.DataReader($stream)
      $null = Await ($reader.LoadAsync([uint32]$size)) ([uint32])
      $bytes = New-Object byte[] $size
      $reader.ReadBytes($bytes)
      $reader.Dispose()
      $artwork = "data:image/png;base64," + [Convert]::ToBase64String($bytes)
    }
    $stream.Dispose()
  }
} catch {}

$obj = @{ title = $props.Title; artist = $props.Artist; status = $st; artwork = $artwork }
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
  private last: MediaInfo = { title: '', artist: '', status: 'Stopped', artwork: '' }
  private querying = false

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

    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY_SCRIPT], {
      timeout: 5000,
      windowsHide: true,
    }, (err, stdout) => {
      this.querying = false
      if (err) return

      try {
        const info = JSON.parse(stdout.trim()) as MediaInfo
        if (info.title !== this.last.title || info.artist !== this.last.artist || info.status !== this.last.status) {
          this.last = info
          this.broadcast(info)
        }
      } catch {
        // ignore parse errors
      }
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
