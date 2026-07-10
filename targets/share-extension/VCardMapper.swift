import Contacts
import Foundation

/// vCard → the exact `contact_metadata` JSON the app's TS parser produces
/// (src/services/messaging/vcardParser.ts). The fixture corpus in
/// src/services/messaging/__tests__/fixtures/vcards/ is the parity contract.
///
/// CNContactVCardSerialization does the RFC heavy lifting for us — line folding,
/// QUOTED-PRINTABLE, CHARSET params, item1.-grouped properties — so this file is
/// only a field mapping, unlike its TypeScript twin which parses by hand.
enum VCardMapper {

    /// Returns nil for an unparseable card, or one with no phone AND no email —
    /// same rule as the TS parser and the in-app contact picker.
    static func contactMetadata(fromVCard data: Data) -> [String: Any]? {
        guard let contacts = try? CNContactVCardSerialization.contacts(with: data),
              let contact = contacts.first
        else { return nil }
        return contactMetadata(from: contact)
    }

    static func contactMetadata(from contact: CNContact) -> [String: Any]? {
        let phones: [[String: Any]] = contact.phoneNumbers.compactMap { labeled in
            let number = labeled.value.stringValue.trimmingCharacters(in: .whitespaces)
            guard !number.isEmpty else { return nil }
            var entry: [String: Any] = ["number": number]
            if let label = displayLabel(labeled.label) { entry["label"] = label }
            return entry
        }

        let emails: [[String: Any]] = contact.emailAddresses.compactMap { labeled in
            let email = (labeled.value as String).trimmingCharacters(in: .whitespaces)
            guard !email.isEmpty else { return nil }
            var entry: [String: Any] = ["email": email]
            if let label = displayLabel(labeled.label) { entry["label"] = label }
            return entry
        }

        guard !phones.isEmpty || !emails.isEmpty else { return nil }

        var meta: [String: Any] = [
            "display_name": displayName(for: contact),
            "phone_numbers": phones,
        ]
        if !emails.isEmpty { meta["emails"] = emails }
        return meta
    }

    // MARK: - private

    private static func displayName(for contact: CNContact) -> String {
        if let formatted = CNContactFormatter.string(from: contact, style: .fullName),
           !formatted.trimmingCharacters(in: .whitespaces).isEmpty {
            return formatted
        }
        // Mirror the TS fallback: prefix given middle family suffix.
        let composed = [
            contact.namePrefix, contact.givenName, contact.middleName,
            contact.familyName, contact.nameSuffix,
        ]
        .filter { !$0.isEmpty }
        .joined(separator: " ")
        return composed.isEmpty ? "Contact" : composed
    }

    /// Contacts wraps labels as `_$!<Mobile>!$_`. localizedString unwraps and
    /// localizes them, which is what the user expects to read on the bubble.
    /// Labels are display-only in ContactBubble, so a locale-dependent string is
    /// acceptable — but it means Swift may emit "Mobile" where TS emits "CELL".
    private static func displayLabel(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        let localized = CNLabeledValue<NSString>.localizedString(forLabel: raw)
        return localized.isEmpty ? nil : localized
    }
}
