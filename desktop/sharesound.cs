// sharesound.exe: the sound that goes with a shared screen or window.
//
// Windows can hand over the sound of one program (and everything it started), or of everything EXCEPT one program.
// That is what makes sharing sound safe in a voice chat:
//   a shared window  ->  --hwnd <window>     only that window's program is heard
//   a shared screen  ->  --exclude <pid>     everything on the PC except Chatterday itself (so nobody's voice goes back out)
// The sound is written to standard output as plain 16-bit stereo at 48 kHz, for the app to read.
//
// Other arguments: --include <pid> (one program, by its process id), --not <pid> (with --hwnd: give up if the window
// belongs to this process, which is how the app refuses to capture itself), --parent <pid> (stop when it is gone).
// Needs Windows 10 2004 or newer. Exit codes: 0 stopped normally, 2 Windows refused, 3 nothing to capture, 4 bad arguments.
//
// Built with the C# compiler that ships with Windows: see "helper" in desktop/package.json.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class ShareSound
{
    [StructLayout(LayoutKind.Sequential)]
    struct ActivationParams { public int ActivationType; public int TargetProcessId; public int ProcessLoopbackMode; }

    // A PROPVARIANT holding a blob: the type tag, six unused bytes, then the blob's size and address.
    [StructLayout(LayoutKind.Sequential)]
    struct PropVariantBlob { public ushort vt; public ushort r1, r2, r3; public int cbSize; public IntPtr pBlobData; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct WaveFormatEx
    {
        public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec;
        public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize;
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, ref WaveFormatEx format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, ref WaveFormatEx format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath, ref Guid iid, IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler, out IActivateAudioInterfaceAsyncOperation operation);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    // Windows calls this back on a thread of its own, so it must be usable from any thread (that is what IAgileObject says).
    sealed class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public int Result = -1;
        public object Client;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            try { operation.GetActivateResult(out Result, out Client); }
            catch (Exception e) { Result = Marshal.GetHRForException(e); }
            Done.Set();
        }
    }

    static bool Alive(int pid)
    {
        // asked once a second for as long as a share lasts: let go of the process handle each time
        try { using (Process p = Process.GetProcessById(pid)) return !p.HasExited; } catch { return false; }
    }

    [MTAThread]
    static int Main(string[] args)
    {
        int target = 0, mode = 0, parent = 0, not = 0;
        long hwnd = 0;
        try
        {
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                if (args[i] == "--include") { target = int.Parse(args[i + 1]); mode = 0; }
                else if (args[i] == "--exclude") { target = int.Parse(args[i + 1]); mode = 1; }
                else if (args[i] == "--hwnd") hwnd = long.Parse(args[i + 1]);
                else if (args[i] == "--parent") parent = int.Parse(args[i + 1]);
                else if (args[i] == "--not") not = int.Parse(args[i + 1]);
            }
        }
        catch { return 4; }
        if (hwnd != 0)
        {
            uint pid;
            GetWindowThreadProcessId(new IntPtr(hwnd), out pid);
            target = (int)pid;
            mode = 0;
        }
        if (target == 0) { Console.Error.WriteLine("nothing to capture"); return hwnd != 0 ? 3 : 4; }
        if (mode == 0 && not != 0 && target == not) { Console.Error.WriteLine("that window is the app itself"); return 3; }

        IntPtr pParams = IntPtr.Zero, pVariant = IntPtr.Zero;
        try
        {
            var activation = new ActivationParams { ActivationType = 1, TargetProcessId = target, ProcessLoopbackMode = mode };
            pParams = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ActivationParams)));
            Marshal.StructureToPtr(activation, pParams, false);
            var variant = new PropVariantBlob { vt = 65, cbSize = Marshal.SizeOf(typeof(ActivationParams)), pBlobData = pParams };
            pVariant = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariantBlob)));
            Marshal.StructureToPtr(variant, pVariant, false);

            var handler = new Handler();
            Guid clientId = typeof(IAudioClient).GUID;
            IActivateAudioInterfaceAsyncOperation operation;
            ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref clientId, pVariant, handler, out operation);
            if (!handler.Done.WaitOne(8000) || handler.Result != 0 || handler.Client == null)
            {
                Console.Error.WriteLine("Windows would not open the sound: 0x" + handler.Result.ToString("X8"));
                return 2;
            }
            var client = (IAudioClient)handler.Client;

            var format = new WaveFormatEx { wFormatTag = 1, nChannels = 2, nSamplesPerSec = 48000, wBitsPerSample = 16, nBlockAlign = 4, nAvgBytesPerSec = 192000, cbSize = 0 };
            // loopback + event-driven + let Windows convert to our format
            int hr = client.Initialize(0, 0x00020000u | 0x00040000u | 0x80000000u | 0x08000000u, 2000000, 0, ref format, IntPtr.Zero);
            if (hr != 0) { Console.Error.WriteLine("could not set the sound up: 0x" + hr.ToString("X8")); return 2; }
            var wake = new AutoResetEvent(false);
            hr = client.SetEventHandle(wake.SafeWaitHandle.DangerousGetHandle());
            if (hr != 0) { Console.Error.WriteLine("no wake-up: 0x" + hr.ToString("X8")); return 2; }
            Guid captureId = typeof(IAudioCaptureClient).GUID;
            object service;
            hr = client.GetService(ref captureId, out service);
            if (hr != 0 || service == null) { Console.Error.WriteLine("no capture: 0x" + hr.ToString("X8")); return 2; }
            var capture = (IAudioCaptureClient)service;
            hr = client.Start();
            if (hr != 0) { Console.Error.WriteLine("would not start: 0x" + hr.ToString("X8")); return 2; }
            Console.Error.WriteLine("capturing");

            Stream stdout = Console.OpenStandardOutput();
            byte[] buffer = new byte[1 << 16];
            var lastCheck = Stopwatch.StartNew();
            for (;;)
            {
                wake.WaitOne(250);
                if (lastCheck.ElapsedMilliseconds > 1000)
                {
                    lastCheck.Restart();
                    if (parent != 0 && !Alive(parent)) return 0;
                    if (mode == 0 && !Alive(target)) return 0;           // the program being shared has closed
                }
                uint frames;
                bool wrote = false;
                while (capture.GetNextPacketSize(out frames) == 0 && frames > 0)
                {
                    IntPtr data; uint got, flags; ulong position, clock;
                    if (capture.GetBuffer(out data, out got, out flags, out position, out clock) != 0) break;
                    int bytes = (int)got * 4;
                    if (bytes > buffer.Length) buffer = new byte[bytes];
                    if ((flags & 2) != 0) Array.Clear(buffer, 0, bytes);       // Windows says this stretch is silence
                    else Marshal.Copy(data, buffer, 0, bytes);
                    capture.ReleaseBuffer(got);
                    stdout.Write(buffer, 0, bytes);
                    wrote = true;
                }
                if (wrote) stdout.Flush();
            }
        }
        catch (IOException) { return 0; }                                // whoever was reading has gone
        catch (Exception e) { Console.Error.WriteLine(e.Message); return 2; }
        finally
        {
            if (pVariant != IntPtr.Zero) Marshal.FreeHGlobal(pVariant);
            if (pParams != IntPtr.Zero) Marshal.FreeHGlobal(pParams);
        }
    }
}
