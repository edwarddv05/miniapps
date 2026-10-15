import AppIntents
internal import SuperappNative

// The Shortcuts action "Descargar enlace". It lives in the app target so
// Shortcuts finds it; the work happens in SuperappNative's BackgroundDownload.
// As a Live Activity intent it runs without opening the app.

@available(iOS 17.0, *)
enum DownloadFormatOption: String, AppEnum {
  case video
  case audio
  case thumbnail

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Formato"
  static let caseDisplayRepresentations: [DownloadFormatOption: DisplayRepresentation] = [
    .video: "Video",
    .audio: "Audio",
    .thumbnail: "Miniatura",
  ]
}

@available(iOS 17.0, *)
enum DownloadQualityOption: String, AppEnum {
  case best
  case p1080
  case p720
  case p480
  case p360

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Calidad"
  static let caseDisplayRepresentations: [DownloadQualityOption: DisplayRepresentation] = [
    .best: "Máxima",
    .p1080: "1080p",
    .p720: "720p",
    .p480: "480p",
    .p360: "360p",
  ]

  /// The tallest picture to take; nil takes the best there is.
  var height: Int? {
    switch self {
    case .best: nil
    case .p1080: 1080
    case .p720: 720
    case .p480: 480
    case .p360: 360
    }
  }
}

@available(iOS 17.0, *)
struct DownloadLinkIntent: AppIntent, LiveActivityIntent {
  static let title: LocalizedStringResource = "Descargar enlace"
  static let description = IntentDescription("Descarga un video, su audio o su miniatura con el progreso en una Live Activity. El archivo aparece en Descargas.")
  static let openAppWhenRun = false

  @Parameter(title: "Enlace")
  var url: URL

  @Parameter(title: "Formato", default: .video)
  var format: DownloadFormatOption

  @Parameter(title: "Calidad", default: .p1080)
  var quality: DownloadQualityOption

  static var parameterSummary: some ParameterSummary {
    Summary("Descargar \(\.$url) como \(\.$format) en \(\.$quality)")
  }

  func perform() async throws -> some IntentResult {
    _ = try await BackgroundDownload.run(url: url, mode: format.rawValue, quality: format == .video ? quality.height : nil)
    return .result()
  }
}
