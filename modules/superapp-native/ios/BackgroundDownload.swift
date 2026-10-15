import ActivityKit
import Foundation
import UIKit

/// The Live Activity of a download started from Shortcuts. The widget
/// extension declares the same type (targets/widget/DownloadActivity.swift);
/// the two must keep the same name and fields.
public struct DownloadActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// analyzing, downloading, preparing, done or error.
    public var stage: String
    public var title: String
    public var detail: String
    /// 0–1, or below 0 while unknown.
    public var fraction: Double
    public var totalBytes: Int?
    public var etaSeconds: Int?
    /// File name of the picture inside the App Group's LiveActivity folder.
    public var thumbnail: String?

    public init(stage: String, title: String, detail: String, fraction: Double, totalBytes: Int? = nil, etaSeconds: Int? = nil, thumbnail: String? = nil) {
      self.stage = stage
      self.title = title
      self.detail = detail
      self.fraction = fraction
      self.totalBytes = totalBytes
      self.etaSeconds = etaSeconds
      self.thumbnail = thumbnail
    }
  }

  public var host: String

  public init(host: String) {
    self.host = host
  }
}

/// Downloads a link without the app on screen: the same yt-dlp jobs and
/// AVFoundation joining as the Downloader, with progress in a Live Activity.
/// Finished files go to Documents/downloads and are listed in
/// background.json, which the app adds to Descargas when it next opens.
public enum BackgroundDownload {
  public static func run(url: URL, mode requested: String, quality: Int?) async throws -> String {
    let host = (url.host ?? "enlace").replacingOccurrences(of: "www.", with: "")
    var state = DownloadActivityAttributes.ContentState(stage: "analyzing", title: host, detail: "Analizando enlace…", fraction: -1)
    let activity: Activity<DownloadActivityAttributes>? = ActivityAuthorizationInfo().areActivitiesEnabled
      ? try? Activity.request(attributes: DownloadActivityAttributes(host: host), content: ActivityContent(state: state, staleDate: nil), pushType: nil)
      : nil
    let extra = await KeepAlive.begin()
    defer { Task { await KeepAlive.end(extra) } }

    do {
      let analysis = try await python("analyze", ["url": url.absoluteString]) as? [String: Any] ?? [:]
      let items = analysis["items"] as? [[String: Any]] ?? []
      let item = items.first
      let modes = analysis["modes"] as? [String] ?? ["video", "audio"]
      var mode = modes.contains(requested) ? requested : (modes.contains("image") ? "image" : modes.first ?? "video")
      var link = url.absoluteString
      var mediaURL: String? = mode == "audio" ? nil : analysis["mediaUrl"] as? String
      var itemIndex: Int?
      if let item {
        if item["kind"] as? String == "image" {
          mode = "image"
          mediaURL = item["mediaUrl"] as? String
        } else if let direct = item["mediaUrl"] as? String, mode != "audio" {
          mediaURL = direct
        } else if item["mediaUrl"] as? String == nil {
          itemIndex = item["index"] as? Int
          link = item["url"] as? String ?? link
        }
      }

      let baseTitle = analysis["title"] as? String ?? host
      let title = items.count > 1 ? "\(baseTitle) · \(item?["title"] as? String ?? "")" : baseTitle
      let thumbnailURL = item?["thumbnail"] as? String ?? analysis["thumbnail"] as? String
      let thumbnail = await LiveThumbnail.save(thumbnailURL)
      let qualities = analysis["qualities"] as? [[String: Any]] ?? []
      let chosen = quality.flatMap { wanted in qualities.first { ($0["height"] as? Int ?? 0) <= wanted } } ?? qualities.first
      let estimate: Int? = mode == "video" && mediaURL == nil ? chosen?["sizeBytes"] as? Int : mode == "audio" ? analysis["audioSizeBytes"] as? Int : nil
      let label = ["video": "Video", "audio": "Audio", "image": "Foto", "thumbnail": "Miniatura"][mode] ?? "Archivo"
      let detail = [label, mode == "video" && mediaURL == nil ? chosen?["label"] as? String : nil, estimate.map { "≈ \(formatBytes($0))" }].compactMap { $0 }.joined(separator: " · ")

      state = .init(stage: "downloading", title: title, detail: detail, fraction: -1, totalBytes: estimate, thumbnail: thumbnail)
      await activity?.update(ActivityContent(state: state, staleDate: nil))

      let started = try await python("start", [
        "url": link,
        "mode": mode,
        "quality": orNull(mode == "video" ? quality : nil),
        "mediaUrl": orNull(mediaURL),
        "itemIndex": orNull(itemIndex),
        "audioLanguage": NSNull(),
      ]) as? [String: Any]
      guard let jobId = started?["jobId"] as? String else { throw NativeMediaError("No se pudo iniciar la descarga.") }

      let began = Date()
      var lastUpdate = Date.distantPast
      var job: [String: Any] = [:]
      while true {
        job = try await python("status", ["jobId": jobId]) as? [String: Any] ?? [:]
        guard job["status"] as? String == "running" else { break }
        if Date().timeIntervalSince(lastUpdate) >= 1 {
          lastUpdate = Date()
          let fraction = job["progress"] as? Double ?? -1
          let elapsed = Date().timeIntervalSince(began)
          state.fraction = fraction
          state.etaSeconds = fraction > 0.05 ? Int(elapsed * (1 - fraction) / fraction) : nil
          await activity?.update(ActivityContent(state: state, staleDate: nil))
        }
        try await Task.sleep(nanoseconds: 500_000_000)
      }
      guard job["status"] as? String == "done", let result = job["result"] as? [String: Any],
            let files = result["files"] as? [String], let first = files.first else {
        throw NativeMediaError(job["error"] as? String ?? "No se pudo completar la descarga.")
      }

      state.stage = "preparing"
      state.fraction = -1
      state.etaSeconds = nil
      await activity?.update(ActivityContent(state: state, staleDate: nil))

      let filename = result["filename"] as? String ?? "archivo"
      let mimeType = result["mimeType"] as? String ?? "application/octet-stream"
      let target = try downloadsFolder().appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000))-\(safeName(filename))")
      let source = URL(fileURLWithPath: first)
      defer { _ = try? SuperappPythonCall("release", jsonText(["jobId": jobId])) }
      switch result["post"] as? String {
      case "merge":
        try await MediaJoiner.export(source: source, audio: files.count > 1 ? URL(fileURLWithPath: files[1]) : nil, to: target, audioOnly: false)
      case "remux-video", "remux-audio":
        do {
          try await MediaJoiner.export(source: source, audio: nil, to: target, audioOnly: result["post"] as? String == "remux-audio")
        } catch {
          try FileManager.default.moveItem(at: source, to: target)
        }
      default:
        try FileManager.default.moveItem(at: source, to: target)
      }

      let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int) ?? nil
      try remember([
        "id": UUID().uuidString,
        "title": title,
        "source": analysis["source"] as? String ?? "other",
        "mode": mode,
        "filename": filename,
        "mimeType": mimeType,
        "uri": target.absoluteString,
        "thumbnail": orNull(thumbnailURL),
        "createdAt": Int(Date().timeIntervalSince1970 * 1000),
        "sizeBytes": orNull(size),
        "durationSeconds": orNull(item?["durationSeconds"] as? Int ?? analysis["durationSeconds"] as? Int),
      ])

      state.stage = "done"
      state.fraction = 1
      state.detail = ["Guardado", size.map { formatBytes($0) }].compactMap { $0 }.joined(separator: " · ")
      await activity?.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
      return title
    } catch {
      state.stage = "error"
      state.detail = (error as? LocalizedError)?.errorDescription ?? "No se pudo descargar."
      state.etaSeconds = nil
      await activity?.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
      throw error
    }
  }

  // MARK: Helpers

  private static func orNull(_ value: Any?) -> Any {
    value ?? NSNull()
  }

  private static func jsonText(_ payload: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self)
  }

  /// Runs one `superapp_dl` call off the main thread and unwraps its envelope.
  private static func python(_ name: String, _ payload: [String: Any]) async throws -> Any? {
    let text = try jsonText(payload)
    let reply: String = await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        continuation.resume(returning: SuperappPythonCall(name, text))
      }
    }
    guard let envelope = try JSONSerialization.jsonObject(with: Data(reply.utf8)) as? [String: Any] else {
      throw NativeMediaError("No se pudo procesar el enlace.")
    }
    if envelope["ok"] as? Bool == true { return envelope["value"] }
    throw NativeMediaError(envelope["error"] as? String ?? "No se pudo procesar el enlace.")
  }

  private static func downloadsFolder() throws -> URL {
    let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let folder = documents.appendingPathComponent("downloads", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }

  /// Same rule as the app's downloadTarget().
  private static func safeName(_ name: String) -> String {
    String(name.unicodeScalars.map { scalar in
      CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII || "._-".unicodeScalars.contains(scalar) ? Character(scalar) : "_"
    })
  }

  private static let ledger = NSLock()

  /// Adds the saved file to background.json for the app to pick up.
  private static func remember(_ entry: [String: Any]) throws {
    ledger.lock()
    defer { ledger.unlock() }
    let file = try downloadsFolder().appendingPathComponent("background.json")
    var entries = (try? JSONSerialization.jsonObject(with: Data(contentsOf: file))) as? [[String: Any]] ?? []
    entries.append(entry)
    try JSONSerialization.data(withJSONObject: entries).write(to: file, options: .atomic)
  }

  static func formatBytes(_ bytes: Int) -> String {
    let mb = Double(bytes) / 1_000_000
    func comma(_ value: Double) -> String { String(format: "%.1f", value).replacingOccurrences(of: ".", with: ",") }
    if mb >= 1000 { return "\(comma(mb / 1000)) GB" }
    if mb >= 10 { return "\(Int(mb.rounded())) MB" }
    if mb >= 1 { return "\(comma(mb)) MB" }
    return "\(max(1, Int((Double(bytes) / 1000).rounded()))) KB"
  }
}

/// Asks iOS for the extra time it grants a task the app started.
private enum KeepAlive {
  @MainActor static func begin() -> UIBackgroundTaskIdentifier {
    var identifier = UIBackgroundTaskIdentifier.invalid
    identifier = UIApplication.shared.beginBackgroundTask(withName: "download") {
      UIApplication.shared.endBackgroundTask(identifier)
    }
    return identifier
  }

  @MainActor static func end(_ identifier: UIBackgroundTaskIdentifier) {
    if identifier != .invalid { UIApplication.shared.endBackgroundTask(identifier) }
  }
}

/// A small copy of the picture in the App Group, where the widget extension can read it.
private enum LiveThumbnail {
  static func save(_ address: String?) async -> String? {
    guard let address, let url = URL(string: address),
          let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedStore.group)?.appendingPathComponent("LiveActivity", isDirectory: true),
          let response = try? await URLSession.shared.data(from: url),
          let image = UIImage(data: response.0) else { return nil }
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    // Older pictures are no longer shown by any activity.
    let week = Date().addingTimeInterval(-7 * 24 * 3600)
    for old in (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
      if let date = try? old.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, date < week {
        try? FileManager.default.removeItem(at: old)
      }
    }
    let side: CGFloat = 120
    let scale = side / min(image.size.width, image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let small = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
      image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
    }
    let name = "\(UUID().uuidString).jpg"
    guard let jpeg = small.jpegData(compressionQuality: 0.8), (try? jpeg.write(to: folder.appendingPathComponent(name))) != nil else { return nil }
    return name
  }
}
