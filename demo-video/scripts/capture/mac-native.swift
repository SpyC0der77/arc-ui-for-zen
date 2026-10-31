// Code-only Arc capture/input helper. Never uses Codex computer-use APIs.
import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("Usage: mac-native probe | windows <bundle-id> | move x y | click x y | key keycode [cmd|shift|option|control ...]") }
if command == "probe" {
    let result: [String: Bool] = ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]
    print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
} else if command == "windows" {
    guard args.count == 2 else { fail("Pass a bundle identifier") }
    let pids = Set(NSRunningApplication.runningApplications(withBundleIdentifier: args[1]).map { $0.processIdentifier })
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    // Deliberately omit window titles, which can contain personal tab names.
    let result = windows.filter { pids.contains(($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? -1) && ($0[kCGWindowLayer as String] as? Int) == 0 }.map {
        ["id": $0[kCGWindowNumber as String]!, "bounds": $0[kCGWindowBounds as String]!] as [String: Any]
    }
    print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
} else {
    guard AXIsProcessTrusted() else { fail("Accessibility access is required for code-driven Arc input. Enable it for the terminal/app launching this helper in System Settings > Privacy & Security > Accessibility.") }
    if command == "drag" {
        guard args.count == 6, let x1=Double(args[1]), let y1=Double(args[2]),
              let x2=Double(args[3]), let y2=Double(args[4]), let duration=Double(args[5]), duration>0 else {
            fail("Usage: mac-native drag x1 y1 x2 y2 seconds")
        }
        let start=CGPoint(x:x1,y:y1),begin=Date.timeIntervalSinceReferenceDate
        CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:start,mouseButton:.left)?.post(tap:.cghidEventTap)
        CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:start,mouseButton:.left)?.post(tap:.cghidEventTap)
        while true {
            let u=min(1,(Date.timeIntervalSinceReferenceDate-begin)/duration),s=u*u*(3-2*u)
            let point=CGPoint(x:x1+(x2-x1)*s,y:y1+(y2-y1)*s)
            CGEvent(mouseEventSource:nil,mouseType:.leftMouseDragged,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap)
            if u>=1 { break }
            Thread.sleep(forTimeInterval:1/60)
        }
        CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:CGPoint(x:x2,y:y2),mouseButton:.left)?.post(tap:.cghidEventTap)
    } else if command == "move" || command == "click" {
        guard args.count == 3, let x = Double(args[1]), let y = Double(args[2]) else { fail("Pass x y") }
        let point = CGPoint(x: x, y: y)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        if command == "click" {
            CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
            CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        }
    } else if command == "key" {
        guard args.count >= 2, let key = UInt16(args[1]) else { fail("Pass a hardware keycode") }
        var flags: CGEventFlags = []
        for modifier in args.dropFirst(2) {
            switch modifier {
            case "cmd": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "option": flags.insert(.maskAlternate)
            case "control": flags.insert(.maskControl)
            default: fail("Unknown modifier: \(modifier)")
            }
        }
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: down)
            event?.flags = flags
            event?.post(tap: .cghidEventTap)
        }
    } else { fail("Unknown command: \(command)") }
}
