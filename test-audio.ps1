$code = @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr n);
  int UnregisterControlChangeNotify(IntPtr n);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, Guid g);
  int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l);
  int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint ch, float l, Guid g);
  int SetChannelVolumeLevelScalar(uint ch, float l, Guid g);
  int GetChannelVolumeLevel(uint ch, out float l);
  int GetChannelVolumeLevelScalar(uint ch, out float l);
  int SetMute(bool m, Guid g);
  int GetMute(out bool m);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int f, int m, IntPtr d);
  int GetDefaultAudioEndpoint(int f, int r, out IMMDevice dev);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, out IAudioEndpointVolume epv);
}
public static class MeeraAudio {
  static IAudioEndpointVolume Endpoint() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev;
    en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    IAudioEndpointVolume epv;
    dev.Activate(ref iid, 1, IntPtr.Zero, out epv);
    return epv;
  }
  public static double GetVolume() { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return v; }
  public static void SetVolume(double v) { Endpoint().SetMasterVolumeLevelScalar((float)v, Guid.Empty); }
  public static bool GetMute() { bool m; Endpoint().GetMute(out m); return m; }
  public static void SetMute(bool m) { Endpoint().SetMute(m, Guid.Empty); }
}
'@
try { Add-Type -TypeDefinition $code -ErrorAction Stop | Out-Null } catch { Write-Output ("COMPILE_FAIL: " + $_.Exception.Message); exit }

$v = [MeeraAudio]::GetVolume()
Write-Output ("CURRENT: " + [int][math]::Round($v * 100) + "% MUTE: " + [MeeraAudio]::GetMute())

[MeeraAudio]::SetVolume(0.42)
Start-Sleep -Milliseconds 200
$nv = [MeeraAudio]::GetVolume()
Write-Output ("AFTER SET 42: " + [int][math]::Round($nv * 100) + "%")
