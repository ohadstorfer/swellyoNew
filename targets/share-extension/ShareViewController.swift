import MobileCoreServices
import Social
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Share to Swellyo".
///
/// Contacts, links and text render an in-sheet picker and send inline via
/// PostgREST. Media — and every failure mode (no/expired token, empty or stale
/// recents cache, unparseable vCard, network error) — stages a payload into the
/// App Group container and opens the app at swellyo://share?staged=<uuid>.
///
/// The fallback is not an error path. It is the Android path, the media path, and
/// the cold-cache path, so it has to be as reliable as the inline one.
class ShareViewController: UIViewController {

    /// Minted once so media files and their payload JSON land in one directory.
    private let stagedId = UUID()
    private var didStart = false

    private enum Payload {
        case contact(meta: [String: Any], raw: String)
        case url(String)
        case text(String)
        case media([SharedStore.StagedFile])

        var previewLine: String {
            switch self {
            case .contact(let meta, _):
                let name = (meta["display_name"] as? String) ?? "Contact"
                return "Contact · \(name)"
            case .url(let u): return u
            case .text(let t): return t
            case .media(let files):
                if files.count > 1 { return "\(files.count) photos" }
                return files.first?.mimeType.hasPrefix("video/") == true ? "Video" : "Photo"
            }
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didStart else { return }  // viewDidAppear can fire more than once
        didStart = true
        Task { await start() }
    }

    // MARK: - flow

    private func start() async {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            return completeAndDismiss()
        }
        let attachments = items.flatMap { $0.attachments ?? [] }
        guard let payload = await resolvePayload(attachments) else {
            return completeAndDismiss()
        }
        await MainActor.run { route(payload) }
    }

    /// Most specific representation wins: a Contacts share also advertises text,
    /// and a photo also advertises a generic file.
    private func resolvePayload(_ attachments: [NSItemProvider]) async -> Payload? {
        if let data = await firstData(of: "public.vcard", in: attachments) {
            return contactPayload(from: data)
        }

        if let movie = await firstStagedFile(of: UTType.movie.identifier, in: attachments) {
            return .media([movie])
        }

        let images = await allStagedFiles(of: UTType.image.identifier, in: attachments)
        if !images.isEmpty { return .media(images) }

        if let url = await firstURL(in: attachments) {
            return .url(url.absoluteString)
        }

        if let text = await firstText(in: attachments), !text.trimmed.isEmpty {
            let t = text.trimmed
            if t.hasPrefix("http://") || t.hasPrefix("https://") { return .url(t) }
            return .text(t)
        }

        // A .vcf that failed to advertise public.vcard (some exporters don't).
        if let file = await firstFileURLNoCopy(of: UTType.data.identifier, in: attachments),
           file.pathExtension.lowercased() == "vcf",
           let data = try? Data(contentsOf: file) {
            return contactPayload(from: data)
        }

        return nil
    }

    private func contactPayload(from data: Data) -> Payload? {
        let raw = String(data: data, encoding: .utf8) ?? ""
        guard let meta = VCardMapper.contactMetadata(fromVCard: data) else {
            // Unparseable, or no phone and no email. Hand the raw card to the app,
            // whose TS parser is a second opinion and can show a friendly error.
            return raw.isEmpty ? nil : .contact(meta: [:], raw: raw)
        }
        return .contact(meta: meta, raw: raw)
    }

    private func route(_ payload: Payload) {
        // Media never sends inline in Phase 1 — the upload pipeline lives in JS.
        if case .media = payload { return stageAndOpen(payload) }
        // An unparseable contact has no metadata to insert; let the app decide.
        if case .contact(let meta, _) = payload, meta.isEmpty { return stageAndOpen(payload) }

        guard let config = SharedStore.loadConfig(),
              let token = KeychainToken.read(),
              token.isUsable,
              // A recents cache written by a previously signed-in user must never
              // be sent to with the current user's token.
              token.user_id == config.userId
        else { return stageAndOpen(payload) }

        presentPicker(config: config, token: token, payload: payload)
    }

    private func presentPicker(
        config: SharedStore.Config,
        token: KeychainToken.Token,
        payload: Payload
    ) {
        let client = SendClient(config: config, token: token)

        let root = ShareView(
            conversations: config.conversations,
            previewLine: payload.previewLine,
            onSend: { convo in
                switch payload {
                case .contact(let meta, _):
                    try await client.sendContact(conversationId: convo.id, contactMetadata: meta)
                case .url(let u):
                    try await client.sendText(conversationId: convo.id, body: u)
                case .text(let t):
                    try await client.sendText(conversationId: convo.id, body: t)
                case .media:
                    return  // unreachable; media never reaches the picker
                }
                await MainActor.run { self.completeAndDismiss() }
            },
            onFallback: { [weak self] in self?.stageAndOpen(payload) },
            onCancel: { [weak self] in
                self?.extensionContext?.cancelRequest(
                    withError: NSError(domain: "com.swellyo.share", code: NSUserCancelledError))
            })

        let host = UIHostingController(rootView: root)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
    }

    // MARK: - staging + handoff

    private func stageAndOpen(_ payload: Payload) {
        let staged: UUID?
        switch payload {
        case .contact(_, let raw):
            staged = SharedStore.stage(id: stagedId, kind: "contact", vcardRaw: raw)
        case .url(let u):
            staged = SharedStore.stage(id: stagedId, kind: "url", url: u)
        case .text(let t):
            staged = SharedStore.stage(id: stagedId, kind: "text", text: t)
        case .media(let files):
            // Files were already copied into share/pending/<stagedId>/ as they were
            // read; writing the JSON now is the commit point.
            staged = SharedStore.stage(id: stagedId, kind: "media", files: files)
        }
        openHostApp(stagedId: staged)
    }

    private func openHostApp(stagedId: UUID?) {
        defer { completeAndDismiss() }
        guard let id = stagedId,
              let url = URL(string: "swellyo://share?staged=\(id.uuidString.lowercased())")
        else { return }

        // Share extensions have no sanctioned openURL. Walking the responder chain
        // for something that answers `openURL:` is the long-standing workaround.
        // If a future iOS breaks it the payload is already staged — the app picks
        // it up on next launch instead of auto-opening.
        let selector = sel_registerName("openURL:")
        var responder: UIResponder? = self
        while let r = responder {
            if r.responds(to: selector) {
                _ = r.perform(selector, with: url)
                return
            }
            responder = r.next
        }
    }

    private func completeAndDismiss() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    // MARK: - attachment readers
    //
    // loadFileRepresentation's URL is only valid inside its completion handler, so
    // the copy into the App Group container happens there, not after.

    private func firstData(of type: String, in items: [NSItemProvider]) async -> Data? {
        for p in items where p.hasItemConformingToTypeIdentifier(type) {
            if let data = await withCheckedContinuation({ (c: CheckedContinuation<Data?, Never>) in
                p.loadDataRepresentation(forTypeIdentifier: type) { data, _ in
                    c.resume(returning: data)
                }
            }) { return data }
        }
        return nil
    }

    private func firstStagedFile(of type: String, in items: [NSItemProvider]) async
        -> SharedStore.StagedFile?
    {
        await allStagedFiles(of: type, in: items).first
    }

    private func allStagedFiles(of type: String, in items: [NSItemProvider]) async
        -> [SharedStore.StagedFile]
    {
        var out: [SharedStore.StagedFile] = []
        for p in items where p.hasItemConformingToTypeIdentifier(type) {
            let staged = await withCheckedContinuation {
                (c: CheckedContinuation<SharedStore.StagedFile?, Never>) in
                p.loadFileRepresentation(forTypeIdentifier: type) { [stagedId] url, _ in
                    guard let url,
                          let path = SharedStore.copyIntoContainer(from: url, stagedId: stagedId)
                    else { return c.resume(returning: nil) }
                    let mime =
                        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/octet-stream"
                    c.resume(returning: SharedStore.StagedFile(path: path, mimeType: mime))
                }
            }
            if let staged { out.append(staged) }
        }
        return out
    }

    /// Peek at a file without copying it — used only to sniff a `.vcf` extension.
    private func firstFileURLNoCopy(of type: String, in items: [NSItemProvider]) async -> URL? {
        for p in items where p.hasItemConformingToTypeIdentifier(type) {
            if let data = await withCheckedContinuation({ (c: CheckedContinuation<URL?, Never>) in
                p.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
                    c.resume(returning: item as? URL)
                }
            }) { return data }
        }
        return nil
    }

    private func firstURL(in items: [NSItemProvider]) async -> URL? {
        let type = UTType.url.identifier
        for p in items where p.hasItemConformingToTypeIdentifier(type) {
            if let url = await withCheckedContinuation({ (c: CheckedContinuation<URL?, Never>) in
                p.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
                    c.resume(returning: item as? URL)
                }
            }), url.isFileURL == false {
                return url
            }
        }
        return nil
    }

    private func firstText(in items: [NSItemProvider]) async -> String? {
        let type = UTType.plainText.identifier
        for p in items where p.hasItemConformingToTypeIdentifier(type) {
            if let s = await withCheckedContinuation({ (c: CheckedContinuation<String?, Never>) in
                p.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
                    c.resume(returning: item as? String)
                }
            }) { return s }
        }
        return nil
    }
}

extension String {
    fileprivate var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
