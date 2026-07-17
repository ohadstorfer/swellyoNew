import ExpoModulesCore
import AVFoundation

/**
 H.264 720p transcode of a local video, run on OUR schedule rather than the
 picker's.

 Why this exists: expo-image-picker can transcode for us via `videoExportPreset`,
 but it does so INSIDE `launchImageLibraryAsync`, before the promise resolves —
 and any non-passthrough preset also costs its `PHAssetResourceManager`
 fast-path. The result is a picker that hangs for the length of the export, so
 the preview only appears once the clip is fully transcoded. Doing the same
 AVAssetExportSession ourselves lets the picker stay on passthrough (instant)
 and the shrink happen after send, while the bubble is already on screen.

 Exposed to JS as `transcode(path)`, resolving the output file:// URL. Any
 failure rejects and the caller simply uploads the original file — the transcode
 is an optimisation, never a requirement.
 */
public class SwellyoVideoExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SwellyoVideoExport")

    AsyncFunction("transcode") { (path: String, promise: Promise) in
      // Accept both a file:// uri and a bare path; fileURLWithPath keeps
      // unencoded spaces/accents/# from defeating URL parsing.
      let filePath = path.hasPrefix("file://") ? String(path.dropFirst("file://".count)) : path
      let sourceURL = URL(fileURLWithPath: filePath)

      guard FileManager.default.fileExists(atPath: sourceURL.path) else {
        promise.reject("ERR_VIDEO_EXPORT", "Source file does not exist")
        return
      }

      let asset = AVURLAsset(url: sourceURL)
      guard let session = AVAssetExportSession(
        asset: asset,
        presetName: AVAssetExportPreset1280x720
      ) else {
        promise.reject("ERR_VIDEO_EXPORT", "Could not create an export session for this asset")
        return
      }

      let outputURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("swellyo-video-\(UUID().uuidString).mp4")

      session.outputURL = outputURL
      session.outputFileType = .mp4
      // Front-load the moov atom. Without this it lands at the end of the file,
      // so nothing can start reading the video until the last byte arrives.
      session.shouldOptimizeForNetworkUse = true

      session.exportAsynchronously {
        switch session.status {
        case .completed:
          promise.resolve(outputURL.absoluteString)
        case .cancelled:
          promise.reject("ERR_VIDEO_EXPORT_CANCELLED", "Export was cancelled")
        default:
          promise.reject(
            "ERR_VIDEO_EXPORT",
            session.error?.localizedDescription ?? "Export failed"
          )
        }
      }
    }
  }
}
