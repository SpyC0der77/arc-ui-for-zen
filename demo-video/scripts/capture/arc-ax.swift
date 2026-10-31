// Code-only native Arc Accessibility helper. No browser profile/file access.
// Compile: swiftc arc-ax.swift -o artifacts/arc-ax
import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
func emit(_ value: Any) {
    do { let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); print(String(data: data, encoding: .utf8)!) }
    catch { fail("JSON serialization failed: \(error)") }
}
let usage = """
arc-ax probe
arc-ax outline WINDOW_ID [DEPTH=6] [LIMIT=500]
arc-ax menu-list WINDOW_ID [DEPTH=5] [LIMIT=500]
arc-ax activate WINDOW_ID
arc-ax wake WINDOW_ID
arc-ax close-window WINDOW_ID
arc-ax frame WINDOW_ID X Y WIDTH HEIGHT
arc-ax click-at WINDOW_ID SCREEN_X SCREEN_Y
arc-ax disclose WINDOW_ID NODE_PATH EXPECTED_DESCENDANT_LABEL true|false
arc-ax press|select WINDOW_ID NODE_PATH EXPECTED_LABEL
arc-ax set-value WINDOW_ID NODE_PATH EXPECTED_LABEL VALUE
arc-ax menu-press WINDOW_ID LABEL [NESTED_LABEL ...]
arc-ax observe WINDOW_ID DEMO_MARKER FEATURE_ID PREDICATE_JSON

Paths are dot-separated child indexes from outline, or 'root'. Menu paths
from menu-list start with 'menu' (e.g. menu.1.0.2). Re-read after UI changes.
press/select/set-value require an exact current title, description, value or
identifier match to EXPECTED_LABEL, protecting against stale paths.

Observer predicate JSON: {"all":[{"where":{"role":"AXButton","title":"Downloads"},"min":1}],
 "none":[{"where":{"title":{"contains":"Loading"}}}],"depth":10,"limit":3000}.
where fields: role, subrole, title, description, value, identifier, selected,
selectedState, enabled, visible, hidden. Visible requires positive node bounds
intersecting the target window and all ancestor AXScrollArea clips, with no
hidden ancestor and AXHidden not true. selectedState mirrors
native AXSelected when available; absent native state remains absent.
Match exact strings/bools or {"contains":"text"}. Empty 'all' is
allowed for the window guard only. The marker must independently occur in a
native title/description/value/identifier. Web-area descendants are excluded;
set include_web:true only for a known dedicated demo window. A bounded scan
that truncates cannot establish readiness. Observer never presses controls.
"""

func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?; return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> String? {
    guard let value = attr(element, name) else { return nil }
    if CFGetTypeID(value) == CFStringGetTypeID() { return value as? String }
    if CFGetTypeID(value) == CFNumberGetTypeID() || CFGetTypeID(value) == CFBooleanGetTypeID() { return String(describing: value) }
    return nil
}
func children(_ element: AXUIElement) -> [AXUIElement] { attr(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func axPoint(_ element: AXUIElement) -> CGPoint? {
    guard let raw = attr(element, kAXPositionAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var value = CGPoint.zero; return AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgPoint, &value) ? value : nil
}
func axSize(_ element: AXUIElement) -> CGSize? {
    guard let raw = attr(element, kAXSizeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var value = CGSize.zero; return AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgSize, &value) ? value : nil
}
func bounds(_ element: AXUIElement) -> [String: Double]? {
    guard let p = axPoint(element), let s = axSize(element) else { return nil }
    return ["x":p.x,"y":p.y,"width":s.width,"height":s.height]
}
func sameFrame(_ a: AXUIElement, _ b: AXUIElement) -> Bool {
    guard let x = bounds(a), let y = bounds(b) else { return false }
    return x.allSatisfy { abs($0.value - (y[$0.key] ?? -99999)) < 2 }
}
func action(_ element: AXUIElement, _ name: String) {
    let error = AXUIElementPerformAction(element, name as CFString)
    guard error == .success else { fail("Native action \(name) failed (AX error \(error.rawValue))") }
}
struct WindowContext {
    let id: Int; let pid: pid_t; let application: AXUIElement; let window: AXUIElement
    init(_ id: Int) {
        self.id = id
        guard AXIsProcessTrusted() else { fail("Accessibility access is required for the launching app/terminal") }
        let all = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
        guard let cg = all.first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == id }),
              let process = cg[kCGWindowOwnerPID as String] as? NSNumber,
              let rect = cg[kCGWindowBounds as String] as? [String:Double]
        else { fail("Specified window is not a current on-screen window") }
        pid = process.int32Value
        guard NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "company.thebrowser.Browser" else { fail("Specified window does not belong to Arc") }
        application = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(application, 2)
        let windows = attr(application,kAXWindowsAttribute) as? [AXUIElement] ?? []
        let numbered = windows.filter { (attr($0,"AXWindowNumber") as? NSNumber)?.intValue == id }
        let matching = numbered.isEmpty ? windows.filter { w in
            guard let frame = bounds(w) else { return false }
            return abs(frame["x"]!-(rect["X"] ?? -99999))<2 && abs(frame["y"]!-(rect["Y"] ?? -99999))<2 &&
                abs(frame["width"]!-(rect["Width"] ?? -99999))<2 && abs(frame["height"]!-(rect["Height"] ?? -99999))<2
        } : numbered
        guard matching.count == 1 else { fail("Cannot uniquely map specified CG window to native AX window; refresh window inventory") }
        window = matching[0]
    }
    var frontmost: Bool {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              let raw = attr(application,kAXFocusedWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return false }
        let focused = unsafeBitCast(raw,to:AXUIElement.self)
        return CFEqual(focused,window) || sameFrame(focused,window)
    }
    func menu() -> AXUIElement {
        guard let raw = attr(application,kAXMenuBarAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { fail("Arc native menu bar is unavailable") }
        return unsafeBitCast(raw,to:AXUIElement.self)
    }
    var menuOpen: Bool {
        children(menu()).contains { (attr($0,kAXSelectedAttribute) as? NSNumber)?.boolValue == true }
    }
    func node(_ path: String) -> AXUIElement {
        var parts = path.split(separator:".").map(String.init)
        var current = window
        if parts.first == "menu" { current = menu(); parts.removeFirst() }
        if parts == ["root"] || parts.isEmpty { return current }
        for piece in parts {
            guard let index = Int(piece), index >= 0 else { fail("Node path must be dot-separated nonnegative indexes") }
            let kids = children(current)
            guard index < kids.count else { fail("Native node path changed; refresh outline") }
            current = kids[index]
        }
        return current
    }
}
let fields = ["role":kAXRoleAttribute,"subrole":kAXSubroleAttribute,"title":kAXTitleAttribute,
              "description":kAXDescriptionAttribute,"value":kAXValueAttribute,"identifier":kAXIdentifierAttribute]
func nodeData(_ element: AXUIElement, path: String, viewport: [String:Double]?) -> [String:Any] {
    var result: [String:Any] = ["path":path]
    for (key,name) in fields { if let value = text(element,name) { result[key] = String(value.prefix(300)) } }
    for (key,name) in ["selected":kAXSelectedAttribute,"enabled":kAXEnabledAttribute] {
        if let value = attr(element,name) as? NSNumber {
            result[key] = value.boolValue
            if key == "selected" { result["selectedState"] = value.boolValue }
        }
    }
    for name in ["AXDisclosing","AXExpanded","AXDisclosureLevel"] {
        if let value=attr(element,name) as? NSNumber { result[name]=value }
    }
    for name in ["AXMenuItemCmdChar","AXMenuItemCmdModifiers","AXMenuItemCmdVirtualKey","AXMenuItemMarkChar"] {
        if let value=text(element,name) { result[name]=value }
    }
    let hidden = (attr(element,"AXHidden") as? NSNumber)?.boolValue == true
    result["hidden"] = hidden
    result["visible"] = false
    if let frame = bounds(element) {
        result["bounds"] = frame
        if let window = viewport {
            let rect = CGRect(x:frame["x"]!,y:frame["y"]!,width:frame["width"]!,height:frame["height"]!)
            let windowRect = CGRect(x:window["x"]!,y:window["y"]!,width:window["width"]!,height:window["height"]!)
            result["visible"] = !hidden && rect.width > 0 && rect.height > 0 && windowRect.width > 0 && windowRect.height > 0 && rect.intersects(windowRect)
        }
    }
    var actions: CFArray?
    if AXUIElementCopyActionNames(element,&actions) == .success { result["actions"] = actions as? [String] ?? [] }
    return result
}
func scan(_ root: AXUIElement, path: String, depth: Int, limit: Int, web: Bool = false, viewport: [String:Double]? = nil) -> ([[String:Any]],Bool) {
    var nodes: [[String:Any]] = []; var truncated = false
    let windowBounds = viewport ?? bounds(root)
    func intersect(_ first: [String:Double]?, _ second: [String:Double]?) -> [String:Double]? {
        guard let a = first else { return second }
        guard let b = second else { return first }
        let rectA = CGRect(x:a["x"]!,y:a["y"]!,width:a["width"]!,height:a["height"]!)
        let rectB = CGRect(x:b["x"]!,y:b["y"]!,width:b["width"]!,height:b["height"]!)
        let result = rectA.intersection(rectB)
        if result.isNull || result.isEmpty { return ["x":0,"y":0,"width":0,"height":0] }
        return ["x":result.minX,"y":result.minY,"width":result.width,"height":result.height]
    }
    func visit(_ element: AXUIElement, _ location: String, _ level: Int, _ clip: [String:Double]?, _ ancestorHidden: Bool) {
        if nodes.count >= limit { truncated = true; return }
        var data = nodeData(element,path:location,viewport:clip)
        let hidden = ancestorHidden || data["hidden"] as? Bool == true
        if hidden { data["visible"] = false }
        nodes.append(data)
        if !web && data["role"] as? String == "AXWebArea" { return }
        let childClip = data["role"] as? String == "AXScrollArea" ? intersect(clip,bounds(element)) : clip
        let kids = children(element)
        if level >= depth { if !kids.isEmpty { truncated = true }; return }
        for (index,kid) in kids.enumerated() {
            let next = location == "root" ? String(index) : "\(location).\(index)"
            visit(kid,next,level+1,childClip,hidden)
            if nodes.count >= limit { truncated = true; break }
        }
    }
    visit(root,path,0,windowBounds,false); return (nodes,truncated)
}
func labelMatches(_ element: AXUIElement, _ expected: String) -> Bool {
    return [kAXTitleAttribute,kAXDescriptionAttribute,kAXValueAttribute,kAXIdentifierAttribute].contains { text(element,$0) == expected }
}
func matches(_ node: [String:Any], _ condition: [String:Any]) -> Bool {
    for (key,expected) in condition {
        guard fields.keys.contains(key) || ["selected","selectedState","enabled","visible","hidden"].contains(key) else { return false }
        guard let actual = node[key] else { return false }
        if let operation = expected as? [String:Any] {
            guard operation.count == 1, let substring = operation["contains"] as? String, let value = actual as? String, value.contains(substring) else { return false }
        } else if let e = expected as? String { if actual as? String != e { return false } }
        else if let e = expected as? NSNumber { if (actual as? NSNumber) != e { return false } }
        else { return false }
    }
    return !condition.isEmpty
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { print(usage); exit(0) }
if command == "help" || command == "--help" { print(usage); exit(0) }
if command == "probe" {
    emit(["accessibility":AXIsProcessTrusted(),"screenRecording":CGPreflightScreenCaptureAccess()]); exit(0)
}
if command == "pointer" {
    let point=CGEvent(source:nil)?.location ?? .zero
    emit(["x":point.x,"y":point.y]);exit(0)
}
guard args.count >= 2, let id = Int(args[1]), id > 0 else { fail("Pass an explicit positive Arc window ID; see --help") }
if command == "wake" {
    guard let arc = NSRunningApplication.runningApplications(withBundleIdentifier:"company.thebrowser.Browser").first else { fail("Arc is not running") }
    arc.activate(options:[])
    Thread.sleep(forTimeInterval:0.6)
}
let context = WindowContext(id)
switch command {
case "type-text":
    guard args.count==3 else { fail("Pass literal text") }
    for unit in args[2].utf16 {
        var character=unit
        for down in [true,false] {
            let event=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:down)
            event?.keyboardSetUnicodeString(stringLength:1,unicodeString:&character)
            event?.post(tap:.cgSessionEventTap)
            Thread.sleep(forTimeInterval:0.008)
        }
    }
    emit(["window_id":id,"performed":"type-text"])
case "focus-node":
    guard args.count==4 else { fail("Pass NODE_PATH EXPECTED_LABEL") }
    let node=context.node(args[2]);guard labelMatches(node,args[3]) else { fail("Native node label changed") }
    guard AXUIElementSetAttributeValue(node,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success else { fail("Cannot focus native control") }
    emit(["window_id":id,"performed":"focus-node"])
case "key-at":
    guard args.count>=3,let key=UInt16(args[2]) else { fail("Pass hardware keycode and optional cmd/shift/option/control") }
    var flags:CGEventFlags=[]
    for modifier in args.dropFirst(3) {
        switch modifier {
        case "cmd":flags.insert(.maskCommand)
        case "shift":flags.insert(.maskShift)
        case "option":flags.insert(.maskAlternate)
        case "control":flags.insert(.maskControl)
        default:fail("Unknown native key modifier")
        }
    }
    for down in [true,false] {
        let event=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:down)
        event?.flags=flags;event?.post(tap:.cgSessionEventTap)
        Thread.sleep(forTimeInterval:0.04)
    }
    emit(["window_id":id,"performed":"key-at"])
case "dismiss-menus":
    let open=context.menuOpen
    let result=open ? AXUIElementPerformAction(context.menu(),kAXCancelAction as CFString):AXError.success
    emit(["window_id":id,"wasOpen":open,"cancelled":open && result == .success])
case "show-default":
    guard args.count==4 else { fail("Pass NODE_PATH EXPECTED_DESCENDANT_LABEL") }
    let node=context.node(args[2]);let (items,_)=scan(node,path:"root",depth:4,limit:100,viewport:bounds(context.window))
    guard items.contains(where:{n in ["title","description","value","identifier"].contains { n[$0] as? String == args[3] }}) else { fail("Native descendant label changed") }
    action(node,"AXShowDefaultUI");emit(["window_id":id,"performed":"show-default"])
case "disclose":
    guard args.count==5,["true","false"].contains(args[4]) else { fail("Pass NODE_PATH EXPECTED_DESCENDANT_LABEL true|false") }
    let node=context.node(args[2])
    let (descendants,_)=scan(node,path:"root",depth:3,limit:100,viewport:bounds(context.window))
    guard descendants.contains(where:{ n in ["title","description","value","identifier"].contains { n[$0] as? String == args[3] } }) else { fail("Native folder descendant label changed") }
    let result=AXUIElementSetAttributeValue(node,"AXDisclosing" as CFString,args[4]=="true" ? kCFBooleanTrue:kCFBooleanFalse)
    guard result == .success else { fail("Native disclosure failed: \(result.rawValue)") }
    emit(["window_id":id,"performed":"disclose"])
case "close-window":
    guard let raw=attr(context.window,kAXCloseButtonAttribute),CFGetTypeID(raw)==AXUIElementGetTypeID() else { fail("Native close control unavailable") }
    action(unsafeBitCast(raw,to:AXUIElement.self),kAXPressAction)
    emit(["window_id":id,"performed":"close-window"])
case "click-at":
    guard args.count == 4, let x=Double(args[2]),let y=Double(args[3]),x.isFinite,y.isFinite else { fail("Pass finite screen X Y") }
    let point=CGPoint(x:x,y:y)
    guard let down=CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left),
          let up=CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:point,mouseButton:.left) else { fail("Cannot create native click") }
    down.setIntegerValueField(.mouseEventClickState,value:1); up.setIntegerValueField(.mouseEventClickState,value:1)
    CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap)
    Thread.sleep(forTimeInterval:0.04)
    down.post(tap:.cghidEventTap); Thread.sleep(forTimeInterval:0.05); up.post(tap:.cghidEventTap)
    Thread.sleep(forTimeInterval:0.1)
    emit(["window_id":id,"performed":"click-at"])
case "outline", "menu-list":
    let depth = args.count > 2 ? Int(args[2]) ?? 6 : 6
    let limit = args.count > 3 ? Int(args[3]) ?? 500 : 500
    guard (0...30).contains(depth), (1...10000).contains(limit) else { fail("Depth must be 0..30 and limit 1..10000") }
    let menu = command == "menu-list"
    let includeWeb=args.count>4 && args[4]=="web"
    let (nodes,truncated) = scan(menu ? context.menu() : context.window,path:menu ? "menu":"root",depth:depth,limit:limit,web:includeWeb,viewport:bounds(context.window))
    emit(["window_id":id,"pid":context.pid,"frontmost":context.frontmost,"nodes":nodes,"truncated":truncated])
case "activate", "wake":
    guard let application = NSRunningApplication(processIdentifier:context.pid) else { fail("Arc process exited") }
    application.activate(options:[.activateIgnoringOtherApps])
    AXUIElementSetAttributeValue(context.application,kAXFocusedWindowAttribute as CFString,context.window)
    AXUIElementSetAttributeValue(context.window,kAXMainAttribute as CFString,kCFBooleanTrue)
    action(context.window,kAXRaiseAction)
    emit(["window_id":id,"requested":true])
case "frame":
    guard args.count == 6, let x = Double(args[2]), let y = Double(args[3]), let w = Double(args[4]), let h = Double(args[5]), x.isFinite,y.isFinite,w.isFinite,h.isFinite,w>0,h>0 else { fail("frame requires finite X Y and positive WIDTH HEIGHT") }
    var point = CGPoint(x:x,y:y); var size = CGSize(width:w,height:h)
    guard let p = AXValueCreate(.cgPoint,&point), let s = AXValueCreate(.cgSize,&size) else { fail("Cannot encode requested frame") }
    let sizeResult = AXUIElementSetAttributeValue(context.window,kAXSizeAttribute as CFString,s)
    let pointResult = AXUIElementSetAttributeValue(context.window,kAXPositionAttribute as CFString,p)
    guard sizeResult == .success, pointResult == .success else { fail("Native window sizing/position failed") }
    emit(["window_id":id,"bounds":bounds(context.window) ?? [:]])
case "press", "confirm", "select", "set-value":
    guard args.count == (command == "set-value" ? 5:4) else { fail("Pass NODE_PATH EXPECTED_LABEL and optional VALUE; see --help") }
    let node = context.node(args[2])
    guard labelMatches(node,args[3]) else { fail("Native node label no longer matches; refresh outline before acting") }
    if command == "confirm" { action(node,kAXConfirmAction) }
    else if command == "press" {
        var names:CFArray?
        AXUIElementCopyActionNames(node,&names)
        let advertised=names as? [String] ?? []
        action(node,advertised.contains(kAXPressAction) ? kAXPressAction : advertised.first(where:{$0.hasPrefix("Name:press")}) ?? kAXPressAction)
    }
    else {
        let result = AXUIElementSetAttributeValue(node,(command == "select" ? kAXSelectedAttribute:kAXValueAttribute) as CFString,command == "select" ? kCFBooleanTrue:args[4] as CFString)
        guard result == .success else { fail("Native attribute update failed (AX error \(result.rawValue))") }
    }
    emit(["window_id":id,"performed":command])
case "menu-press":
    guard args.count >= 3 else { fail("Pass exact native menu labels") }
    var parent = context.menu()
    for (index,label) in args.dropFirst(2).enumerated() {
        let immediate = children(parent)
        let candidates = immediate.filter { text($0,kAXTitleAttribute) == label } + immediate.filter { text($0,kAXRoleAttribute) == "AXMenu" }.flatMap(children).filter { text($0,kAXTitleAttribute) == label }
        guard candidates.count == 1 else { fail("Exact native menu label unavailable or ambiguous: \(label)") }
        parent = candidates[0]
        action(parent,kAXPressAction)
        Thread.sleep(forTimeInterval:0.15)
    }
    emit(["window_id":id,"performed":"menu-press"])
case "observe":
    guard args.count == 5, args[2].count >= 8 else { fail("observe requires DEMO_MARKER FEATURE_ID PREDICATE_JSON") }
    do {
        let raw = try Data(contentsOf:URL(fileURLWithPath:args[4]))
        guard let spec = try JSONSerialization.jsonObject(with:raw) as? [String:Any],
              let all = spec["all"] as? [[String:Any]], !all.isEmpty || args[3] == "window-guard" else { fail("Observer requires all predicates; only window-guard may have an empty all array") }
        let depth = min(30,max(1,spec["depth"] as? Int ?? 10)); let limit = min(10000,max(1,spec["limit"] as? Int ?? 3000))
        let (nodes,truncated) = scan(context.window,path:"root",depth:depth,limit:limit,web:spec["include_web"] as? Bool ?? false)
        let marker = nodes.contains { node in ["title","description","value","identifier"].contains { (node[$0] as? String)?.contains(args[2]) == true } }
        func satisfied(_ predicate: [String:Any]) -> Bool {
            guard let condition = predicate["where"] as? [String:Any] else { return false }
            let count = nodes.filter { matches($0,condition) }.count
            let minimum = predicate["min"] as? Int ?? 1
            let maximum = predicate["max"] as? Int ?? Int.max
            return minimum >= 0 && count >= minimum && count <= maximum
        }
        let none = spec["none"] as? [[String:Any]] ?? []
        let ready = marker && !truncated && context.frontmost && all.allSatisfy(satisfied) && !none.contains(where:satisfied)
        emit(["ready":ready,"window_id":id,"demo_marker":args[2],"feature_id":args[3],"frontmost":context.frontmost,"markerFound":marker,"truncated":truncated])
    } catch { fail("Cannot read native predicate JSON: \(error)") }
default: fail("Unknown command; see --help")
}
