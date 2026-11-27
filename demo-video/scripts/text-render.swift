// Renders text with Core Text (the macOS text engine) for the demo video.
//
//   text-render <out.png> <size> <weight> <r> <g> <b> <tracking> <text>
//
// weight: Regular | Medium | Semibold | Bold. tracking is extra spacing in
// points (0 keeps the font's own spacing). Uses the system font, so SF Pro gets
// its optical sizes, kerning and display tracking exactly as macOS draws them.
// Output is a tightly sized RGBA PNG; the baseline sits at a fixed offset from
// the bottom (descent + 2 px) so sprites line up like a text layout.
import AppKit
import CoreText

let a = CommandLine.arguments
guard a.count == 9, let size = Double(a[2]), let r = Double(a[4]), let g = Double(a[5]), let b = Double(a[6]),
      let tracking = Double(a[7]) else {
    FileHandle.standardError.write("Usage: text-render out.png size weight r g b tracking text\n".data(using: .utf8)!)
    exit(2)
}
let weights: [String: NSFont.Weight] = ["Regular": .regular, "Medium": .medium, "Semibold": .semibold, "Bold": .bold]
let font = NSFont.systemFont(ofSize: size, weight: weights[a[3]] ?? .regular)
var attrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: 1),
]
if tracking != 0 { attrs[.kern] = tracking }
let line = CTLineCreateWithAttributedString(NSAttributedString(string: a[8], attributes: attrs))
var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
let width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
let pad: CGFloat = 3
let w = Int(ceil(width + pad * 2)), h = Int(ceil(ascent + descent + pad * 2))
let ctx = CGContext(data: nil, width: max(w, 1), height: max(h, 1), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setAllowsAntialiasing(true)
ctx.setShouldAntialias(true)
ctx.setAllowsFontSubpixelPositioning(true)
ctx.setShouldSubpixelPositionFonts(true)
ctx.setAllowsFontSmoothing(false)  // no stem darkening; matches how macOS draws on transparent layers
ctx.textPosition = CGPoint(x: pad, y: pad + descent)
CTLineDraw(line, ctx)
let image = ctx.makeImage()!
let url = URL(fileURLWithPath: a[1]) as CFURL
let dest = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
