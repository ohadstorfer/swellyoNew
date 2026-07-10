import Foundation

/// PostgREST insert mirroring messagingService.createTypedMessageWithMetadata:
/// upsert on (sender_id, client_id) ignoring duplicates, then touch
/// conversations.updated_at.
///
/// Both DB constraints apply and name each other confusingly on violation:
///   - messages_type_check   — the type whitelist ('contact' and 'file' included)
///   - check_message_type    — type/metadata consistency
/// A 'contact' row carries contact_metadata and NO other metadata column; a
/// 'text' row carries none at all. Note check_message_type only *forbids*
/// commitment_metadata on a contact row — it does not require contact_metadata,
/// so a null here would insert cleanly and render as an empty bubble. Guarding
/// that is this file's job, not the database's. The column is `body`, not `content`.
///
/// After the insert, the app's DB triggers fan out realtime + push. This client
/// does not know realtime or notifications exist, and must not.
struct SendClient {
    let supabaseUrl: String
    let anonKey: String
    let accessToken: String
    let userId: String

    enum SendError: Error {
        case http(Int, String)
        case badURL
    }

    init(config: SharedStore.Config, token: KeychainToken.Token) {
        self.supabaseUrl = config.supabaseUrl
        self.anonKey = config.anonKey
        self.accessToken = token.access_token
        self.userId = token.user_id
    }

    func sendContact(conversationId: String, contactMetadata: [String: Any]) async throws {
        try await insertMessage(
            conversationId: conversationId,
            type: "contact",
            body: "",
            extra: ["contact_metadata": contactMetadata])
    }

    func sendText(conversationId: String, body: String) async throws {
        try await insertMessage(conversationId: conversationId, type: "text", body: body, extra: [:])
    }

    // MARK: - private

    private func insertMessage(
        conversationId: String,
        type: String,
        body: String,
        extra: [String: Any]
    ) async throws {
        var payload: [String: Any] = [
            "conversation_id": conversationId,
            "sender_id": userId,
            "type": type,
            "body": body,
            // Idempotency key; also lets the app swap its optimistic row when
            // realtime echoes this insert back.
            "client_id": UUID().uuidString.lowercased(),
        ]
        for (k, v) in extra { payload[k] = v }

        guard let url = URL(string: "\(supabaseUrl)/rest/v1/messages?on_conflict=sender_id,client_id")
        else { throw SendError.badURL }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("resolution=ignore-duplicates,return=minimal", forHTTPHeaderField: "Prefer")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        req.timeoutInterval = 15

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw SendError.http(-1, "no response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SendError.http(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        await touchConversation(conversationId)
    }

    /// Best-effort parity with the JS send path. A miss is tolerable: the inbox
    /// sorts on conversationRecency, which also reads last_message.created_at.
    private func touchConversation(_ id: String) async {
        guard var comps = URLComponents(string: "\(supabaseUrl)/rest/v1/conversations") else { return }
        comps.queryItems = [URLQueryItem(name: "id", value: "eq.\(id)")]
        guard let url = comps.url else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        req.httpBody = try? JSONSerialization.data(
            withJSONObject: ["updated_at": ISO8601DateFormatter().string(from: Date())])
        req.timeoutInterval = 10

        _ = try? await URLSession.shared.data(for: req)
    }
}
