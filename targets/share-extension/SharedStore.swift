import Foundation

/// Reads the config + recents blob the RN app writes into the App Group container
/// (src/services/shareRecentsCache.ts) and stages fallback payloads for the app to
/// consume (src/services/shareIntake.ts `loadStagedShare` / `normalizeStagedPayload`).
///
/// The JSON field names here are a contract with those two TypeScript files.
/// Change them together or not at all.
enum SharedStore {
    static let appGroup = "group.com.swellyo.app"

    struct RecentConversation: Decodable, Identifiable, Hashable {
        let id: String
        let title: String
        let avatarUrl: String?
        let isDirect: Bool
    }

    struct Config: Decodable {
        let version: Int
        let supabaseUrl: String
        let anonKey: String
        let userId: String
        let conversations: [RecentConversation]
    }

    struct StagedFile {
        let path: String
        let mimeType: String
    }

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    /// nil when the user has never opened the app, or logged out (the app deletes
    /// this file in its logout choreography). Callers must fall back to opening the app.
    static func loadConfig() -> Config? {
        guard let url = containerURL?.appendingPathComponent("share/recents.json"),
              let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(Config.self, from: data),
              !config.conversations.isEmpty
        else { return nil }
        return config
    }

    /// Directory that media for `id` must be copied into before `stage` is called.
    static func pendingDirectory(for id: UUID) -> URL? {
        guard let container = containerURL else { return nil }
        let dir = container.appendingPathComponent(
            "share/pending/\(id.uuidString.lowercased())", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Copy a shared file into the container so it outlives this process's sandbox
    /// extension. MUST be called before `stage` — the JSON is the commit point and
    /// must never reference files that don't exist yet.
    static func copyIntoContainer(from src: URL, stagedId: UUID) -> String? {
        guard let dir = pendingDirectory(for: stagedId) else { return nil }
        let dst = dir.appendingPathComponent(src.lastPathComponent)
        try? FileManager.default.removeItem(at: dst)
        do {
            try FileManager.default.copyItem(at: src, to: dst)
            return dst.path
        } catch {
            return nil
        }
    }

    /// Write the payload JSON. This is the atomic commit: the app only ever sees a
    /// staged share once this file lands, by which point its media already exists.
    /// The caller supplies `id` so media paths and the JSON share one directory.
    @discardableResult
    static func stage(
        id: UUID,
        kind: String,
        text: String? = nil,
        url: String? = nil,
        vcardRaw: String? = nil,
        files: [StagedFile] = []
    ) -> UUID? {
        guard let container = containerURL else { return nil }
        let dir = container.appendingPathComponent("share/pending", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var payload: [String: Any] = [
            "version": 1,
            "createdAt": ISO8601DateFormatter().string(from: Date()),
            "kind": kind,
        ]
        if let text { payload["text"] = text }
        if let url { payload["url"] = url }
        if let vcardRaw { payload["vcardRaw"] = vcardRaw }
        if !files.isEmpty {
            payload["files"] = files.map { ["path": $0.path, "mimeType": $0.mimeType] }
        }

        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        let dst = dir.appendingPathComponent("\(id.uuidString.lowercased()).json")
        do {
            try data.write(to: dst, options: .atomic)
            return id
        } catch {
            return nil
        }
    }
}
