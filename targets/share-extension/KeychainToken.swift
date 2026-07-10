import Foundation

/// Reads the Supabase access token that sessionBridge.ts publishes via
/// expo-secure-store. NEVER refresh or write from here: Supabase rotates refresh
/// tokens, and a refresh from this process would invalidate the app's copy and
/// silently log the user out. An expired token means "open the app" — nothing else.
///
/// The query mirrors expo-secure-store's `query(with:options:)` EXACTLY
/// (node_modules/expo-secure-store/ios/SecureStoreModule.swift). Two traps:
///   1. It appends ":no-auth" to keychainService when requireAuthentication is
///      false (our case), so the service is NOT plain "swellyo-share".
///   2. kSecAttrAccount and kSecAttrGeneric are Data(key.utf8), NOT Strings.
/// Get either wrong and SecItemCopyMatching returns errSecItemNotFound forever.
///
/// It writes kSecAttrAccessible = kSecAttrAccessibleWhenUnlocked (the library
/// default), which is fine here: a share sheet only runs on an unlocked device.
enum KeychainToken {
    struct Token: Decodable {
        let access_token: String
        /// epoch seconds, matching Supabase's Session.expires_at
        let expires_at: Double
        let user_id: String

        /// 60s of slack so we never start a request with a token that dies mid-flight.
        var isUsable: Bool {
            access_token.isEmpty == false && Date().timeIntervalSince1970 < expires_at - 60
        }
    }

    private static let accessGroup = "group.com.swellyo.app"
    private static let keyData = Data("swellyo.session".utf8)

    static func read() -> Token? {
        // ":no-auth" is what set() writes; the bare service is the legacy alias.
        // Mirrors expo-secure-store's own get() fallback order.
        for service in ["swellyo-share:no-auth", "swellyo-share"] {
            if let token = read(service: service) { return token }
        }
        return nil
    }

    private static func read(service: String) -> Token? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: keyData,
            kSecAttrGeneric as String: keyData,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: kCFBooleanTrue as Any,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(Token.self, from: data)
    }
}
