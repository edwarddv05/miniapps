import ActivityKit
import SwiftUI
import WidgetKit

// The Live Activity of a download started from Shortcuts. The app declares the
// same attributes in modules/superapp-native/ios/BackgroundDownload.swift; the
// two must keep the same name and fields.

struct DownloadActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var stage: String
    var title: String
    var detail: String
    var fraction: Double
    var totalBytes: Int?
    var etaSeconds: Int?
    var thumbnail: String?
  }

  var host: String
}

private extension DownloadActivityAttributes.ContentState {
  var finished: Bool { stage == "done" || stage == "error" }
  var known: Bool { fraction >= 0 && (stage == "downloading" || stage == "done") }
  var tint: Color { stage == "done" ? .green : stage == "error" ? .red : .blue }
  var percent: Int { Int((max(0, min(1, fraction)) * 100).rounded()) }

  /// "50 de 120 MB", or the stage while there is no figure.
  var progressLine: String? {
    if stage == "preparing" { return "Uniendo video y audio" }
    guard stage == "downloading", let total = totalBytes, fraction >= 0 else { return nil }
    return "\(bytes(Int(Double(total) * fraction))) de \(bytes(total))"
  }

  var etaLine: String? {
    guard stage == "downloading", let eta = etaSeconds else { return nil }
    return eta >= 60 ? "quedan \(eta / 60):\(String(format: "%02d", eta % 60))" : "quedan \(eta) s"
  }

  private func bytes(_ value: Int) -> String {
    let mb = Double(value) / 1_000_000
    if mb >= 1000 { return String(format: "%.1f GB", mb / 1000).replacingOccurrences(of: ".", with: ",") }
    if mb >= 10 { return "\(Int(mb.rounded())) MB" }
    if mb >= 1 { return String(format: "%.1f MB", mb).replacingOccurrences(of: ".", with: ",") }
    return "\(max(1, value / 1000)) KB"
  }
}

/// The picture the app left in the App Group, or a plain tile.
private struct DownloadThumb: View {
  let name: String?
  let size: CGFloat

  var body: some View {
    Group {
      if let name, let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedStore.group),
         let image = UIImage(contentsOfFile: folder.appendingPathComponent("LiveActivity/\(name)").path) {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        ZStack {
          Color.gray.opacity(0.3)
          Image(systemName: "arrow.down").font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(.secondary)
        }
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
  }
}

/// The percentage, or a mark once it is over.
private struct DownloadTrailing: View {
  let state: DownloadActivityAttributes.ContentState

  var body: some View {
    if state.finished {
      Image(systemName: state.stage == "done" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
        .font(.system(size: 30))
        .foregroundStyle(state.tint)
    } else if state.known {
      Text("\(state.percent) %")
        .font(.system(size: 26, weight: .bold, design: .rounded))
        .monospacedDigit()
        .contentTransition(.numericText())
    }
  }
}

private struct DownloadBar: View {
  let state: DownloadActivityAttributes.ContentState

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.primary.opacity(0.15))
        Capsule()
          .fill(state.tint)
          .frame(width: max(6, geo.size.width * (state.known ? state.fraction : 0.12)))
      }
    }
    .frame(height: 6)
  }
}

/// The ring for the Dynamic Island's compact and minimal shapes.
private struct DownloadRing: View {
  let state: DownloadActivityAttributes.ContentState

  var body: some View {
    if state.finished {
      Image(systemName: state.stage == "done" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
        .foregroundStyle(state.tint)
    } else {
      ZStack {
        Circle().stroke(Color.white.opacity(0.2), lineWidth: 3)
        Circle()
          .trim(from: 0, to: state.known ? max(0.04, state.fraction) : 0.25)
          .stroke(state.tint, style: StrokeStyle(lineWidth: 3, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
      .frame(width: 20, height: 20)
    }
  }
}

private struct DownloadLockView: View {
  let state: DownloadActivityAttributes.ContentState
  let host: String

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        DownloadThumb(name: state.thumbnail, size: 52)
        VStack(alignment: .leading, spacing: 2) {
          Text(state.title).font(.headline).lineLimit(1)
          Text(state.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 8)
        DownloadTrailing(state: state)
      }
      if !state.finished {
        DownloadBar(state: state)
      }
      HStack {
        Text(state.finished ? (state.stage == "done" ? "Toca para abrir Descargas" : "Ábrelo en la app para reintentar") : state.progressLine ?? host)
        Spacer()
        if let eta = state.etaLine { Text(eta) }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .monospacedDigit()
    }
    .padding(16)
  }
}

struct DownloadActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DownloadActivityAttributes.self) { context in
      DownloadLockView(state: context.state, host: context.attributes.host)
        .widgetURL(URL(string: "miniapps://downloads"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          DownloadThumb(name: context.state.thumbnail, size: 46)
        }
        DynamicIslandExpandedRegion(.trailing) {
          DownloadTrailing(state: context.state)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text(context.state.title).font(.headline).lineLimit(1)
            Text(context.state.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if !context.state.finished {
            DownloadBar(state: context.state).padding(.top, 4)
          }
        }
      } compactLeading: {
        DownloadThumb(name: context.state.thumbnail, size: 22)
      } compactTrailing: {
        DownloadRing(state: context.state)
      } minimal: {
        DownloadRing(state: context.state)
      }
      .widgetURL(URL(string: "miniapps://downloads"))
    }
  }
}
