// Real-time window video for the demo: ScreenCaptureKit, one window only.
//
//   window-recorder <window-id> <output.mov> [fps] [x y width height]
//
// The optional rectangle (window points) crops at capture time, so pixels
// outside it are never recorded.
//
// Records only the given window (other windows, the desktop and the system
// cursor are never captured) until stdin closes or SIGINT/SIGTERM. Frames keep
// their host-clock timestamps. On start it prints {"ready":true,...}. On exit it
// prints {"first":<host seconds of first frame>,"frames":n,...}. Host seconds
// are mach_absolute_time based, the same clock as Python's
// time.clock_gettime(time.CLOCK_UPTIME_RAW).
import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// ScreenCaptureKit needs an initialized window-server connection.
_ = NSApplication.shared
let args = Array(CommandLine.arguments.dropFirst())
if args.first == "list", args.count == 2, let pid = Int32(args[1]) {
    // `window-recorder list <pid>`: normal windows of one process. Titles are
    // omitted because they can contain personal tab names.
    let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let result = windows.filter {
        ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid && ($0[kCGWindowLayer as String] as? Int) == 0
    }.map { ["id": $0[kCGWindowNumber as String]!, "bounds": $0[kCGWindowBounds as String]!,
             "onscreen": ($0[kCGWindowIsOnscreen as String] as? Bool) ?? false] as [String: Any] }
    print(String(data: try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
    exit(0)
}
guard args.count >= 2, let windowID = UInt32(args[0]) else { fail("Usage: window-recorder <window-id> <output.mov> [fps]") }
let output = URL(fileURLWithPath: args[1])
let fps = args.count > 2 ? Int32(args[2]) ?? 60 : 60
try? FileManager.default.removeItem(at: output)

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor
    var first: CMTime?
    var last: CMTime?
    var frames = 0
    var dropped = 0
    let queue = DispatchQueue(label: "frames")

    init(width: Int, height: Int) throws {
        writer = try AVAssetWriter(outputURL: output, fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 45_000_000,
                AVVideoExpectedSourceFrameRateKey: 60,
                AVVideoAllowFrameReorderingKey: false,
            ],
        ])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
        writer.add(input)
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let buffer = CMSampleBufferGetImageBuffer(sample) else { return }
        let time = CMSampleBufferGetPresentationTimeStamp(sample)
        if first == nil {
            first = time
            writer.startWriting()
            writer.startSession(atSourceTime: time)
        }
        if writer.status == .failed {
            fail("Writer failed: \(writer.error?.localizedDescription ?? "unknown")")
        }
        if input.isReadyForMoreMediaData {
            if adaptor.append(buffer, withPresentationTime: time) {
                frames += 1
                last = time
            }
        } else {
            dropped += 1
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fail("Capture stopped: \(error.localizedDescription)")
    }
}

let semaphore = DispatchSemaphore(value: 0)
var recorder: Recorder!
var stream: SCStream!
Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let window = content.windows.first(where: { $0.windowID == windowID }) else { fail("Window \(windowID) not found") }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = filter.pointPixelScale
        var region = CGRect(origin: .zero, size: window.frame.size)
        if args.count >= 7, let x = Double(args[3]), let y = Double(args[4]), let w = Double(args[5]), let h = Double(args[6]) {
            region = CGRect(x: x, y: y, width: w, height: h)
        }
        let width = Int(region.width * CGFloat(scale)) & ~1
        let height = Int(region.height * CGFloat(scale)) & ~1
        let config = SCStreamConfiguration()
        if args.count >= 7 { config.sourceRect = region }
        config.width = width
        config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: fps)
        config.showsCursor = false
        config.queueDepth = 8
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.colorSpaceName = CGColorSpace.sRGB
        recorder = try Recorder(width: width, height: height)
        stream = SCStream(filter: filter, configuration: config, delegate: recorder)
        try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: recorder.queue)
        try await stream.startCapture()
        let now = CMClockGetTime(CMClockGetHostTimeClock()).seconds
        print("{\"ready\":true,\"width\":\(width),\"height\":\(height),\"host\":\(now)}")
        fflush(stdout)
    } catch {
        fail("Could not start capture: \(error.localizedDescription)")
    }
    semaphore.signal()
}
semaphore.wait()

func finish() -> Never {
    let done = DispatchSemaphore(value: 0)
    Task {
        try? await stream.stopCapture()
        recorder.queue.sync {}
        if recorder.first != nil {
            recorder.input.markAsFinished()
            await recorder.writer.finishWriting()
        }
        let first = recorder.first?.seconds ?? 0
        let last = recorder.last?.seconds ?? 0
        print("{\"first\":\(first),\"last\":\(last),\"frames\":\(recorder.frames),\"dropped\":\(recorder.dropped),\"status\":\(recorder.writer.status.rawValue)}")
        fflush(stdout)
        done.signal()
    }
    done.wait()
    exit(recorder.writer.status == .completed ? 0 : 1)
}

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let sources = [SIGINT, SIGTERM].map { sig -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { finish() }
    source.resume()
    return source
}
DispatchQueue.global().async {
    while readLine() != nil {}
    DispatchQueue.main.async { finish() }
}
_ = sources
dispatchMain()
