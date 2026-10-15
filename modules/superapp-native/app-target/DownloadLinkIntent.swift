import AppIntents
import UniformTypeIdentifiers
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
enum DownloadDestinationOption: String, AppEnum {
  case photos
  case files
  case app

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Guardar en"
  static let caseDisplayRepresentations: [DownloadDestinationOption: DisplayRepresentation] = [
    .photos: "Fotos",
    .files: "Archivos",
    .app: "Solo la app",
  ]
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

  @Parameter(title: "Guardar en", default: .photos)
  var destination: DownloadDestinationOption

  static var parameterSummary: some ParameterSummary {
    Summary("Descargar \(\.$url) como \(\.$format) en \(\.$quality) y guardar en \(\.$destination)")
  }

  // The file is the action's output, so the next action can save it to
  // Photos or Files.
  func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
    let saved = try await BackgroundDownload.run(url: url, mode: format.rawValue, quality: format == .video ? quality.height : nil, destination: destination.rawValue)
    let type = UTType(filenameExtension: saved.file.pathExtension) ?? .data
    return .result(value: IntentFile(fileURL: saved.file, filename: saved.filename, type: type))
  }
}
