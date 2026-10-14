import AVFoundation
import CoreImage
import ExpoModulesCore
import ExpoUI
import WidgetKit

public class SuperappNativeModule: Module {
  // Analysis takes seconds and status polls must not wait behind it.
  private let pythonQueue = DispatchQueue(label: "superapp.python", qos: .userInitiated, attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("SuperappNative")

    AsyncFunction("python") { (name: String, payload: String, promise: Promise) in
      self.pythonQueue.async {
        promise.resolve(SuperappPythonCall(name, payload))
      }
    }

    AsyncFunction("joinMedia") { (video: String, audio: String?, output: String) async throws in
      try await MediaJoiner.export(source: fileURL(video), audio: audio.map(fileURL), to: fileURL(output), audioOnly: false)
    }

    AsyncFunction("remuxAudio") { (input: String, output: String) async throws in
      try await MediaJoiner.export(source: fileURL(input), audio: nil, to: fileURL(output), audioOnly: true)
    }

    AsyncFunction("ambientColor") { (url: String) async -> String? in
      await AmbientColor.of(url)
    }

    Function("setWidgetSchedule") { (json: String) in
      SharedStore.defaults?.set(json, forKey: SharedStore.scheduleKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    // Animated SwiftUI views for @expo/ui trees (AnimationViews.swift).
    ExpoUIView(PopInView.self)
    ExpoUIView(LiquidProgressView.self)
    ExpoUIView(SkyView.self)
    ExpoUIView(SteamCupView.self)
  }
}

private func fileURL(_ value: String) -> URL {
  if value.hasPrefix("file://"), let url = URL(string: value) { return url }
  return URL(fileURLWithPath: value)
}

struct NativeMediaError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

/// Joins separate video and audio streams, or rewrites a fragmented file, into
/// one plain MP4/M4A with its index at the front: Photos, WhatsApp and the
/// share sheet refuse fragmented files. Streams are copied, never re-encoded.
enum MediaJoiner {
  static func export(source: URL, audio: URL?, to output: URL, audioOnly: Bool) async throws {
    let composition = AVMutableComposition()
    let main = AVURLAsset(url: source)

    if audioOnly {
      guard let track = try await main.loadTracks(withMediaType: .audio).first else {
        throw NativeMediaError("El archivo no tiene audio.")
      }
      let range = try await track.load(.timeRange)
      try composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)?
        .insertTimeRange(range, of: track, at: .zero)
    } else {
      guard let videoTrack = try await main.loadTracks(withMediaType: .video).first else {
        throw NativeMediaError("El archivo no tiene video.")
      }
      let videoRange = try await videoTrack.load(.timeRange)
      let composedVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
      try composedVideo?.insertTimeRange(videoRange, of: videoTrack, at: .zero)
      composedVideo?.preferredTransform = try await videoTrack.load(.preferredTransform)

      let soundAsset = audio.map { AVURLAsset(url: $0) } ?? main
      if let audioTrack = try await soundAsset.loadTracks(withMediaType: .audio).first {
        let audioRange = try await audioTrack.load(.timeRange)
        let duration = CMTimeMinimum(audioRange.duration, videoRange.duration)
        try composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)?
          .insertTimeRange(CMTimeRange(start: audioRange.start, duration: duration), of: audioTrack, at: .zero)
      }
    }

    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
      throw NativeMediaError("Este formato no se puede guardar en el iPhone.")
    }
    let fileType: AVFileType = audioOnly ? .m4a : .mp4
    guard session.supportedFileTypes.contains(fileType) else {
      throw NativeMediaError("Este formato no se puede guardar en el iPhone.")
    }
    session.outputURL = output
    session.outputFileType = fileType
    session.shouldOptimizeForNetworkUse = true
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { continuation.resume() }
    }
    guard session.status == .completed else {
      try? FileManager.default.removeItem(at: output)
      throw NativeMediaError(session.error?.localizedDescription ?? "No se pudo preparar el archivo.")
    }
  }
}

/// The thumbnail's average colour lifted to a clear mid tone, for the page's
/// ambient glow. Same formula as the PC service.
enum AmbientColor {
  static func of(_ address: String) async -> String? {
    guard let url = URL(string: address),
          let (data, _) = try? await URLSession.shared.data(from: url),
          let image = CIImage(data: data),
          let filter = CIFilter(name: "CIAreaAverage", parameters: [kCIInputImageKey: image, kCIInputExtentKey: CIVector(cgRect: image.extent)]),
          let average = filter.outputImage else { return nil }
    var pixel = [UInt8](repeating: 0, count: 4)
    CIContext(options: [.workingColorSpace: NSNull()]).render(average, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
    var (hue, lightness, saturation) = rgbToHls(Double(pixel[0]) / 255, Double(pixel[1]) / 255, Double(pixel[2]) / 255)
    lightness = min(0.62, max(0.42, lightness))
    saturation = min(0.85, max(0.4, saturation * 1.4))
    let (red, green, blue) = hlsToRgb(hue, lightness, saturation)
    return String(format: "#%02X%02X%02X", Int((red * 255).rounded()), Int((green * 255).rounded()), Int((blue * 255).rounded()))
  }

  // Python's colorsys, so the glow matches the PC version.
  private static func rgbToHls(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    let high = max(r, g, b), low = min(r, g, b)
    let lightness = (low + high) / 2
    if high == low { return (0, lightness, 0) }
    let span = high - low
    let saturation = lightness <= 0.5 ? span / (high + low) : span / (2 - high - low)
    let rc = (high - r) / span, gc = (high - g) / span, bc = (high - b) / span
    var hue = r == high ? bc - gc : g == high ? 2 + rc - bc : 4 + gc - rc
    hue = (hue / 6).truncatingRemainder(dividingBy: 1)
    if hue < 0 { hue += 1 }
    return (hue, lightness, saturation)
  }

  private static func hlsToRgb(_ h: Double, _ l: Double, _ s: Double) -> (Double, Double, Double) {
    if s == 0 { return (l, l, l) }
    let m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s
    let m1 = 2 * l - m2
    func value(_ hue: Double) -> Double {
      var hue = hue.truncatingRemainder(dividingBy: 1)
      if hue < 0 { hue += 1 }
      if hue < 1 / 6 { return m1 + (m2 - m1) * hue * 6 }
      if hue < 0.5 { return m2 }
      if hue < 2 / 3 { return m1 + (m2 - m1) * (2 / 3 - hue) * 6 }
      return m1
    }
    return (value(h + 1 / 3), value(h), value(h - 1 / 3))
  }
}

/// The App Group shared with the widget. AltStore and SideStore re-register
/// groups under the signing team and list the real identifiers in each
/// bundle's Info.plist as `ALTAppGroups`.
enum SharedStore {
  static let declaredGroup = "group.com.mysuperapp.miniapps"
  static let scheduleKey = "schedule"

  static var group: String {
    let groups = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? []
    return groups.filter { $0.hasPrefix(declaredGroup) }.min(by: { $0.count < $1.count }) ?? groups.first ?? declaredGroup
  }

  static var defaults: UserDefaults? { UserDefaults(suiteName: group) }
}
