import UIKit
import UniformTypeIdentifiers

/// "Downloader" in the share sheet: takes the shared link and opens the app on
/// the Downloader, which downloads it with the default format. Downloading
/// happens in the app because an extension is stopped as soon as it closes.
final class ShareViewController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Task { @MainActor in
      guard let link = await sharedLink(),
            var components = URLComponents(string: "miniapps://download") else {
        return finish(error: true)
      }
      components.queryItems = [URLQueryItem(name: "url", value: link.absoluteString)]
      if let target = components.url { openContainingApp(target) }
      finish(error: false)
    }
  }

  private func sharedLink() async -> URL? {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) as? URL, isWeb(url) { return url }
    }
    // TikTok and other apps share text with the link inside it.
    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) as? String, let url = firstLink(in: text) { return url }
    }
    return nil
  }

  private func isWeb(_ url: URL) -> Bool {
    url.scheme == "https" || url.scheme == "http"
  }

  private func firstLink(in text: String) -> URL? {
    let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    let range = NSRange(text.startIndex..., in: text)
    return detector?.matches(in: text, range: range).compactMap(\.url).first(where: isWeb)
  }

  /// Extensions cannot use UIApplication.shared; the application object is
  /// reached through the responder chain instead.
  private func openContainingApp(_ url: URL) {
    let selector = sel_registerName("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication, application.responds(to: selector) {
        typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
        let implementation = unsafeBitCast(application.method(for: selector), to: OpenURL.self)
        implementation(application, selector, url as NSURL, NSDictionary(), nil)
        return
      }
      responder = current.next
    }
  }

  private func finish(error: Bool) {
    if error {
      extensionContext?.cancelRequest(withError: NSError(domain: "Downloader", code: 1, userInfo: [NSLocalizedDescriptionKey: "No hay un enlace para descargar."]))
    } else {
      extensionContext?.completeRequest(returningItems: nil)
    }
  }
}
