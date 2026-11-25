// Renders text with DirectWrite (the Windows text engine) for the demo video.
// Windows counterpart of text-render.swift, with the same command line:
//
//   text-render <out.png> <size> <weight> <r> <g> <b> <tracking> <text>
//
// weight: Regular | Medium | Semibold | Bold. tracking is extra spacing in
// pixels (0 keeps the font's own spacing). Uses Segoe UI Variable through the
// typographic font model, with the weight axis set exactly and the optical
// size axis chosen automatically from the size, so large titles get the
// Display design and small labels the Text/Small designs, with OpenType
// kerning, as Windows draws them. Output is a tightly sized RGBA PNG; the
// baseline sits at a fixed offset from the bottom (0.24 em + 3 px) so sprites
// line up like a text layout.
using System;
using System.Globalization;
using System.IO;
using System.Numerics;
using Vortice.Direct2D1;
using Vortice.DirectWrite;
using Vortice.DXGI;
using Vortice.Mathematics;
using Vortice.WIC;
using AlphaMode = Vortice.DCommon.AlphaMode;
using PixelFormat = Vortice.DCommon.PixelFormat;

static class Program
{
    const string Family = "Segoe UI Variable";

    static int Main(string[] a)
    {
        var inv = CultureInfo.InvariantCulture;
        if (a.Length != 8)
        {
            Console.Error.WriteLine("Usage: text-render out.png size weight r g b tracking text");
            return 2;
        }
        float size = float.Parse(a[1], inv);
        float weight = a[2] switch { "Medium" => 500, "Semibold" => 600, "Bold" => 700, _ => 400 };
        var color = new Color4(float.Parse(a[3], inv) / 255f, float.Parse(a[4], inv) / 255f, float.Parse(a[5], inv) / 255f, 1f);
        float tracking = float.Parse(a[6], inv);
        string text = a[7];

        using var dw = DWrite.DWriteCreateFactory<IDWriteFactory7>();
        using var collection = dw.GetSystemFontCollection(false, FontFamilyModel.Typographic);
        var axes = new[] { new FontAxisValue { AxisTag = FontAxisTag.Weight, Value = weight } };
        using var baseFormat = dw.CreateTextFormat(Family, collection, axes, (uint)axes.Length, size, "en-us");
        using var format = baseFormat.QueryInterface<IDWriteTextFormat3>();
        format.AutomaticFontAxes = AutomaticFontAxes.OpticalSize;
        format.WordWrapping = WordWrapping.NoWrap;
        using var layout = dw.CreateTextLayout(text, format, 100000, 100000);
        if (tracking != 0)
            using (var l1 = layout.QueryInterface<IDWriteTextLayout1>())
                l1.SetCharacterSpacing(0, tracking, 0, new TextRange(0, (uint)text.Length));

        // Fixed vertical metrics per size, so every sprite of a size has the same
        // height and baseline.
        float ascent, descent;
        using (var wws = dw.GetSystemFontCollection(false))
        {
            bool found = wws.FindFamilyName("Segoe UI Variable Text", out uint index);
            if (!found) wws.FindFamilyName("Segoe UI", out index);
            using var family = wws.GetFontFamily(index);
            using var font = family.GetFirstMatchingFont((FontWeight)(int)weight, FontStretch.Normal, FontStyle.Normal);
            using var face = font.CreateFontFace();
            var m = face.Metrics;
            // Segoe's Windows ascent/descent (about 1.33 em in total) leave room
            // for stacked accents; use an SF-like line box instead, so stacked
            // lines sit as close as the macOS sprites do.
            ascent = Math.Min(m.Ascent * size / m.DesignUnitsPerEm, 0.92f * size);
            descent = Math.Min(m.Descent * size / m.DesignUnitsPerEm, 0.24f * size);
        }
        if (Environment.GetEnvironmentVariable("TEXT_RENDER_DEBUG") != null)
            Console.Error.WriteLine($"ascent {ascent} descent {descent} baseline {layout.LineMetrics[0].Baseline} height {layout.LineMetrics[0].Height}");
        var lines = layout.LineMetrics;
        var metrics = layout.Metrics;
        const float pad = 3;
        int w = Math.Max(1, (int)Math.Ceiling(metrics.WidthIncludingTrailingWhitespace + pad * 2));
        int h = Math.Max(1, (int)Math.Ceiling(ascent + descent + pad * 2));

        using var wic = new IWICImagingFactory();
        using var bitmap = wic.CreateBitmap((uint)w, (uint)h, Vortice.WIC.PixelFormat.Format32bppPBGRA, BitmapCreateCacheOption.CacheOnLoad);
        using var d2d = D2D1.D2D1CreateFactory<ID2D1Factory>();
        var props = new RenderTargetProperties(new PixelFormat(Format.B8G8R8A8_UNorm, AlphaMode.Premultiplied));
        using (var rt = d2d.CreateWicBitmapRenderTarget(bitmap, props))
        using (var brush = rt.CreateSolidColorBrush(color))
        using (var rp = dw.CreateCustomRenderingParams(1.8f, 0f, 0f, 0f, PixelGeometry.Flat,
                   RenderingMode1.NaturalSymmetric, GridFitMode.Disabled))
        {
            // Grayscale antialiasing (ClearType cannot blend onto transparency),
            // no stem darkening, subpixel positioning: clean at video scale.
            rt.TextAntialiasMode = Vortice.Direct2D1.TextAntialiasMode.Grayscale;
            rt.TextRenderingParams = rp;
            rt.BeginDraw();
            rt.Clear(new Color4(0, 0, 0, 0));
            rt.DrawTextLayout(new Vector2(pad, pad + ascent - lines[0].Baseline), layout, brush, DrawTextOptions.EnableColorFont);
            rt.EndDraw();
        }

        var path = Path.GetFullPath(a[0]);
        using (var stream = wic.CreateStream(path, FileAccess.Write))
        using (var encoder = wic.CreateEncoder(ContainerFormat.Png, stream))
        using (var frame = encoder.CreateNewFrame(out var bag))
        {
            frame.Initialize(bag);
            frame.SetSize((uint)w, (uint)h);
            var fmt = Vortice.WIC.PixelFormat.Format32bppBGRA;
            frame.SetPixelFormat(ref fmt);
            using var converter = wic.CreateFormatConverter();
            converter.Initialize(bitmap, Vortice.WIC.PixelFormat.Format32bppBGRA, BitmapDitherType.None, null, 0, BitmapPaletteType.Custom);
            frame.WriteSource(converter);
            frame.Commit();
            encoder.Commit();
        }
        return 0;
    }
}
