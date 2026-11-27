// Real-time window video for the demo on Windows: Windows.Graphics.Capture,
// one window only. Counterpart of window-recorder.swift (macOS).
//
//   window-recorder list <pid>
//   window-recorder <hwnd> <output.mp4> [fps] [x y width height]
//
// The optional rectangle (window pixels) crops at capture time, so pixels
// outside it are never recorded. Only the given window is captured: other
// windows, the desktop and the system cursor never reach the file, even when
// they overlap it. Recording stops when stdin closes.
//
// Frames are placed on a constant-rate grid (default 60 fps) by their capture
// timestamp, holding the previous frame when the window did not change. On
// start it prints {"ready":true,...}; on exit {"first":<seconds>,"frames":n,
// "unique":u,...}. Seconds are QueryPerformanceCounter based, the same clock
// as Python's time.perf_counter() on Windows. <output>.frames.json lists the
// grid index of every frame that carried new pixels, to verify the frame rate.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using WinRT;

namespace WindowRecorder;

[ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IGraphicsCaptureItemInterop
{
    IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
    IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
}

[ComImport, Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDirect3DDxgiInterfaceAccess
{
    IntPtr GetInterface([In] ref Guid iid);
}

static class Native
{
    [DllImport("d3d11.dll", ExactSpelling = true)]
    public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] public static extern int WindowsCreateString(string s, int length, out IntPtr hstring);
    [DllImport("combase.dll")] public static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}

static class Program
{
    static readonly Guid ItemIid = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");
    static readonly Guid TextureIid = typeof(ID3D11Texture2D).GUID;

    static double Seconds(long qpc) => qpc / (double)Stopwatch.Frequency;

    static int Main(string[] args)
    {
        Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels
        if (args.Length == 2 && args[0] == "list")
            return List(uint.Parse(args[1]));
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: window-recorder list <pid> | window-recorder <hwnd> <output.mp4> [fps] [x y w h]");
            return 2;
        }
        var hwnd = new IntPtr(long.Parse(args[0]));
        var output = Path.GetFullPath(args[1]);
        int fps = args.Length > 2 ? int.Parse(args[2]) : 60;
        int[] crop = args.Length >= 7 ? new[] { int.Parse(args[3]), int.Parse(args[4]), int.Parse(args[5]), int.Parse(args[6]) } : null;
        return Record(hwnd, output, fps, crop);
    }

    static int List(uint pid)
    {
        // Titles are omitted because they can contain personal tab names.
        var rows = new List<string>();
        Native.EnumWindows((h, _) =>
        {
            Native.GetWindowThreadProcessId(h, out var owner);
            if (owner != pid || Native.GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            Native.DwmGetWindowAttribute(h, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out Native.RECT r, Marshal.SizeOf<Native.RECT>());
            Native.DwmGetWindowAttribute(h, 14 /* DWMWA_CLOAKED */, out int cloaked, 4);
            var cls = new StringBuilder(256);
            Native.GetClassName(h, cls, cls.Capacity);
            bool onscreen = Native.IsWindowVisible(h) && !Native.IsIconic(h) && cloaked == 0;
            rows.Add($"{{\"id\":{h.ToInt64()},\"class\":{System.Text.Json.JsonSerializer.Serialize(cls.ToString())},\"onscreen\":{(onscreen ? "true" : "false")}," +
                     $"\"bounds\":{{\"X\":{r.Left},\"Y\":{r.Top},\"Width\":{r.Right - r.Left},\"Height\":{r.Bottom - r.Top}}}}}");
            return true;
        }, IntPtr.Zero);
        Console.WriteLine("[" + string.Join(",", rows) + "]");
        return 0;
    }

    sealed class Slot { public long Index; public byte[] Pixels; }

    static int Record(IntPtr hwnd, string output, int fps, int[] crop)
    {
        D3D11.D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.BgraSupport,
            new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 }, out ID3D11Device device, out ID3D11DeviceContext context).CheckError();
        using var dxgi = device.QueryInterface<IDXGIDevice>();
        Marshal.ThrowExceptionForHR(Native.CreateDirect3D11DeviceFromDXGIDevice(dxgi.NativePointer, out var inspectable));
        var winrtDevice = MarshalInterface<IDirect3DDevice>.FromAbi(inspectable);
        Marshal.Release(inspectable);

        const string cls = "Windows.Graphics.Capture.GraphicsCaptureItem";
        Marshal.ThrowExceptionForHR(Native.WindowsCreateString(cls, cls.Length, out var hcls));
        var interopIid = typeof(IGraphicsCaptureItemInterop).GUID;
        Marshal.ThrowExceptionForHR(Native.RoGetActivationFactory(hcls, ref interopIid, out var factoryPtr));
        var interop = (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(factoryPtr);
        var iid = ItemIid;
        var itemPtr = interop.CreateForWindow(hwnd, ref iid);
        var item = GraphicsCaptureItem.FromAbi(itemPtr);
        Marshal.Release(itemPtr);

        var size = item.Size;
        int x0 = 0, y0 = 0, width = size.Width, height = size.Height;
        if (crop != null)
        {
            x0 = Math.Max(0, crop[0]); y0 = Math.Max(0, crop[1]);
            width = Math.Min(crop[2], size.Width - x0); height = Math.Min(crop[3], size.Height - y0);
        }
        width &= ~1; height &= ~1;
        if (width <= 0 || height <= 0) { Console.Error.WriteLine("Empty capture area"); return 1; }

        var staging = device.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)width, Height = (uint)height, MipLevels = 1, ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm, SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Staging, CPUAccessFlags = CpuAccessFlags.Read, BindFlags = BindFlags.None,
        });

        var encoder = Environment.GetEnvironmentVariable("ARC_DEMO_ENCODER") ?? "h264_nvenc";
        var codec = encoder == "libx264"
            ? "-c:v libx264 -preset ultrafast -crf 6 -pix_fmt yuv444p"
            : $"-c:v {encoder} -preset p5 -tune hq -rc constqp -qp 10 -pix_fmt yuv444p";
        var ff = Process.Start(new ProcessStartInfo("ffmpeg",
            $"-y -v error -f rawvideo -pix_fmt bgra -s {width}x{height} -framerate {fps} -i - {codec} " +
            $"-color_primaries bt709 -color_trc iec61966-2-1 -colorspace bt709 -movflags +faststart \"{output}\"")
        { RedirectStandardInput = true, UseShellExecute = false });
        var sink = ff.StandardInput.BaseStream;

        var pool = new ConcurrentBag<byte[]>();
        byte[] Rent() => pool.TryTake(out var b) ? b : new byte[width * height * 4];
        var queue = new BlockingCollection<Slot>(new ConcurrentQueue<Slot>(), 240);
        long firstQpc = -1, delivered = 0, written = 0, unique = 0, maxGap = 0;
        var fresh = new List<long>();
        var gate = new object();
        double frame = 1.0 / fps;

        var writer = new Thread(() =>
        {
            Slot pending = null;
            void Emit(Slot s, long times)
            {
                for (long i = 0; i < times; i++)
                {
                    sink.Write(s.Pixels, 0, s.Pixels.Length);
                    written++;
                }
            }
            foreach (var slot in queue.GetConsumingEnumerable())
            {
                if (slot.Pixels == null) // stop marker: hold the last frame until the stop time
                {
                    if (pending != null) { Emit(pending, Math.Max(1, slot.Index - pending.Index + 1)); }
                    break;
                }
                if (pending == null) { pending = slot; continue; }
                if (slot.Index <= pending.Index) { pool.Add(pending.Pixels); pending = new Slot { Index = pending.Index, Pixels = slot.Pixels }; continue; }
                maxGap = Math.Max(maxGap, slot.Index - pending.Index);
                Emit(pending, slot.Index - pending.Index);
                lock (fresh) fresh.Add(pending.Index);
                unique++;
                pool.Add(pending.Pixels);
                pending = slot;
            }
            if (pending != null) { lock (fresh) fresh.Add(pending.Index); unique++; }
            sink.Flush();
            sink.Close();
        }) { IsBackground = true, Priority = ThreadPriority.AboveNormal };
        writer.Start();

        var framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(winrtDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 3, size);
        var session = framePool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled = false;
        try { session.IsBorderRequired = false; } catch { /* older Windows: border is on screen only */ }
        // The default minimum interval (~1/60 s) rounds up to every third vsync
        // on a 144 Hz display (48 fps). Take every presented frame; the grid
        // keeps the newest one per 1/fps slot.
        try { session.MinUpdateInterval = TimeSpan.FromMilliseconds(2); } catch { }
        bool stopping = false;
        var readyEvent = new ManualResetEventSlim();
        framePool.FrameArrived += (sender, _) =>
        {
            using var f = sender.TryGetNextFrame();
            if (f == null) return;
            lock (gate)
            {
                if (stopping) return;
                long qpc = (long)(f.SystemRelativeTime.Ticks * (Stopwatch.Frequency / 1e7));
                if (firstQpc < 0) firstQpc = qpc;
                long index = (long)Math.Round((Seconds(qpc) - Seconds(firstQpc)) / frame);
                var access = f.Surface.As<IDirect3DDxgiInterfaceAccess>();
                var tid = TextureIid;
                using var texture = new ID3D11Texture2D(access.GetInterface(ref tid));
                var cs = f.ContentSize;
                int cw = Math.Min(width, cs.Width - x0), ch = Math.Min(height, cs.Height - y0);
                var pixels = Rent();
                if (cw > 0 && ch > 0)
                {
                    context.CopySubresourceRegion(staging, 0, 0, 0, 0, texture, 0,
                        new Vortice.Mathematics.Box(x0, y0, 0, x0 + cw, y0 + ch, 1));
                    var map = context.Map(staging, 0, MapMode.Read);
                    try
                    {
                        unsafe
                        {
                            fixed (byte* dst = pixels)
                                for (int y = 0; y < height; y++)
                                    Buffer.MemoryCopy((byte*)map.DataPointer + (long)y * map.RowPitch, dst + (long)y * width * 4, width * 4, width * 4);
                        }
                    }
                    finally { context.Unmap(staging, 0); }
                }
                delivered++;
                queue.Add(new Slot { Index = index, Pixels = pixels });
                readyEvent.Set();
            }
        };
        session.StartCapture();
        long host = Stopwatch.GetTimestamp();
        Console.WriteLine($"{{\"ready\":true,\"width\":{width},\"height\":{height},\"host\":{Seconds(host):F6}}}");
        Console.Out.Flush();

        // Stop when stdin closes.
        while (Console.In.Read() >= 0) { }
        long end = Stopwatch.GetTimestamp();
        lock (gate)
        {
            stopping = true;
            long last = firstQpc < 0 ? 0 : (long)Math.Round((Seconds(end) - Seconds(firstQpc)) / frame);
            queue.Add(new Slot { Index = last, Pixels = null });
        }
        session.Dispose();
        framePool.Dispose();
        queue.CompleteAdding();
        writer.Join();
        ff.WaitForExit();
        lock (fresh)
            File.WriteAllText(output + ".frames.json", "{\"fps\":" + fps + ",\"fresh\":[" + string.Join(",", fresh) + "]}");
        Console.WriteLine($"{{\"first\":{(firstQpc < 0 ? 0 : Seconds(firstQpc)):F6},\"frames\":{written},\"delivered\":{delivered}," +
                          $"\"unique\":{unique},\"maxGap\":{maxGap},\"fps\":{fps},\"width\":{width},\"height\":{height},\"exit\":{ff.ExitCode}}}");
        return ff.ExitCode == 0 && written > 0 ? 0 : 1;
    }
}
