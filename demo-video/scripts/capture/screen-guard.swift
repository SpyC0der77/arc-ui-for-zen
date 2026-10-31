// Guard screen captures against unrelated windows and missing demo backdrop.
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 7, let browser = Int(args[1]), let backdrop = Int(args[2]),
      let x = Double(args[3]), let y = Double(args[4]),
      let width = Double(args[5]), let height = Double(args[6]) else { exit(2) }
let area = CGRect(x:x, y:y, width:width, height:height)
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
var browserFound = false
var backdropFound = false
for window in windows {
    guard let pid = window[kCGWindowOwnerPID as String] as? Int,
          let bounds = window[kCGWindowBounds as String] as? [String:Double],
          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.intersects(area),
          (window[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { continue }
    if pid == browser {
        if abs(rect.minX-x)<1 && abs(rect.minY-y)<1 && abs(rect.width-width)<1 && abs(rect.height-height)<1 { browserFound = true }
        continue
    }
    if pid == backdrop && rect.contains(area) {
        backdropFound = true
        break
    }
    // WindowServer publishes the small native mouse cursor as a topmost
    // window. It contains no app content and is expected during pointer moves.
    if (window[kCGWindowOwnerName as String] as? String) == "Window Server",
       (window[kCGWindowLayer as String] as? Int) == 2147483630,
       rect.width <= 64, rect.height <= 64 { continue }
    // A different visible surface above the controlled backdrop could contain
    // private data, even if the intended browser still has keyboard focus.
    let layer = window[kCGWindowLayer as String] as? Int ?? 0
    fputs("Screen capture blocked: unrelated process \(pid), layer \(layer), overlaps the demo.\n", stderr)
    exit(1)
}
guard browserFound && backdropFound else {
    fputs("Screen capture blocked: demo browser or controlled backdrop is missing.\n", stderr)
    exit(1)
}
