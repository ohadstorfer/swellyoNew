import ExpoModulesCore
import QuickLook
import UIKit

/**
 In-app preview of a local document via Apple's QuickLook (QLPreviewController) —
 the engine behind Files and Mail. Renders Office formats, RTF, PDF, images and
 iWork natively and offline. Exposed to JS as `preview(path)`, which resolves
 true once the controller is presented and false when there is no view controller
 to present from (should not happen while the app is foregrounded).

 The data source is retained on the module for the lifetime of the presentation:
 QLPreviewController holds its dataSource weakly, so a local would be released the
 instant `preview` returns and the preview would render nothing. Each call
 overwrites the previous source — a single URL wrapper, harmless to keep.
 */

private class QuickLookSource: NSObject, QLPreviewControllerDataSource {
  let url: NSURL
  init(url: URL) { self.url = url as NSURL }
  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    return url
  }
}

public class SwellyoQuickLookModule: Module {
  /// Retained while a controller is presented (see the class doc).
  private var source: QuickLookSource?

  public func definition() -> ModuleDefinition {
    Name("SwellyoQuickLook")

    AsyncFunction("preview") { (path: String, promise: Promise) in
      DispatchQueue.main.async {
        // Accept both a file:// uri and a bare filesystem path. Use
        // fileURLWithPath for both so an unencoded space/accent/# in the path
        // does not defeat URL parsing (URL(string:) returns nil for those).
        let filePath = path.hasPrefix("file://") ? String(path.dropFirst("file://".count)) : path
        let fileURL = URL(fileURLWithPath: filePath)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
          promise.resolve(false)
          return
        }
        guard let presenter = Self.topViewController() else {
          promise.resolve(false)
          return
        }
        let src = QuickLookSource(url: fileURL)
        self.source = src
        let controller = QLPreviewController()
        controller.dataSource = src
        presenter.present(controller, animated: true) {
          promise.resolve(true)
        }
      }
    }
  }

  /// The top-most presented view controller under the key window's root.
  private static func topViewController() -> UIViewController? {
    let keyWindow = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}
