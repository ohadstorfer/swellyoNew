import UserNotifications
import Intents

// Rebuilds each incoming Swellyo message push as an iOS Communication
// Notification: a large round avatar (sender photo for DMs, group hero image for
// groups) with the Swellyo app icon stamped in the corner automatically by iOS.
//
// The edge function `send-push-notification` sends `mutable-content: 1` plus the
// avatar URL + sender/group identity in the payload's `data` object.
class NotificationService: UNNotificationServiceExtension {
  var contentHandler: ((UNNotificationContent) -> Void)?
  var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    self.bestAttempt = request.content.mutableCopy() as? UNMutableNotificationContent

    guard let bestAttempt = bestAttempt else {
      contentHandler(request.content)
      return
    }

    NSLog("[SwellyoNSE] didReceive fired. userInfo keys: \(Array(request.content.userInfo.keys))")
    // DIAG (temporary): prove the extension ran. This marker is ONLY visible if
    // we end up falling back to a plain notification — on success the avatar UI
    // replaces the title. So: avatar = success; "🟢" prefix = ran-but-fell-back;
    // no "🟢" at all = the extension never ran (mutable-content never arrived).
    bestAttempt.title = "🟢 " + bestAttempt.title

    let data = Self.extractData(from: request.content.userInfo)
    NSLog("[SwellyoNSE] extracted data keys: \(Array(data.keys))")

    let senderName = (data["senderName"] as? String) ?? bestAttempt.title
    let senderId = (data["senderId"] as? String) ?? senderName
    let conversationId = data["conversationId"] as? String
    let isGroup = (data["isGroup"] as? Bool) ?? false
    let groupName = data["groupName"] as? String
    let messageText = (data["message"] as? String) ?? bestAttempt.body
    let avatarUrl = data["avatarUrl"] as? String
    NSLog("[SwellyoNSE] isGroup=\(isGroup) sender=\(senderName) avatarUrl=\(avatarUrl ?? "nil")")

    // In a Communication Notification iOS shows the sender name itself, so the
    // body must be the raw message only. (The edge function's "Sender: message"
    // fallback is for devices/builds without this extension.)
    bestAttempt.body = messageText

    // Build + deliver the communication notification once the avatar is ready.
    let finish: (INImage?) -> Void = { avatarImage in
      let handle = INPersonHandle(value: senderId, type: .unknown)
      let sender = INPerson(
        personHandle: handle,
        nameComponents: nil,
        displayName: senderName,
        image: isGroup ? nil : avatarImage, // DM avatar lives on the person
        contactIdentifier: nil,
        customIdentifier: nil
      )

      let intent: INSendMessageIntent
      if isGroup {
        let speakable = INSpeakableString(spokenPhrase: groupName ?? "Group")
        intent = INSendMessageIntent(
          recipients: nil,
          outgoingMessageType: .outgoingMessageText,
          content: messageText,
          speakableGroupName: speakable,
          conversationIdentifier: conversationId,
          serviceName: nil,
          sender: sender,
          attachments: nil
        )
        // For groups the big thumbnail is the GROUP image.
        if let img = avatarImage {
          intent.setImage(img, forParameterNamed: \.speakableGroupName)
        }
      } else {
        intent = INSendMessageIntent(
          recipients: [sender],
          outgoingMessageType: .outgoingMessageText,
          content: messageText,
          speakableGroupName: nil,
          conversationIdentifier: conversationId,
          serviceName: nil,
          sender: sender,
          attachments: nil
        )
      }

      let interaction = INInteraction(intent: intent, response: nil)
      interaction.direction = .incoming
      interaction.donate { _ in }

      do {
        let updated = try bestAttempt.updating(from: intent)
        NSLog("[SwellyoNSE] updating(from:) succeeded — delivering communication notification")
        contentHandler(updated)
      } catch {
        NSLog("[SwellyoNSE] updating(from:) FAILED: \(error.localizedDescription) — falling back to plain")
        // DIAG (temporary): surface the failure reason + whether an image URL was
        // present, right in the notification body so it's readable without a Mac.
        bestAttempt.body = "NSE-FAIL: \(error.localizedDescription) | url=\(avatarUrl ?? "nil")"
        contentHandler(bestAttempt) // graceful fallback → plain notification
      }
    }

    // Fetch the avatar image, then finish. No URL → still deliver (plain).
    guard let urlString = avatarUrl, !urlString.isEmpty, let url = URL(string: urlString) else {
      finish(nil)
      return
    }
    URLSession.shared.dataTask(with: url) { imageData, _, _ in
      let image = imageData.flatMap { INImage(imageData: $0) }
      finish(image)
    }.resume()
  }

  // iOS gives the extension ~30s; deliver our best effort if we run out of time.
  override func serviceExtensionTimeWillExpire() {
    if let contentHandler = contentHandler, let bestAttempt = bestAttempt {
      contentHandler(bestAttempt)
    }
  }

  // Expo delivers the custom `data` object either as a nested dictionary under
  // `data`, or JSON-stringified under the top-level `body` key — handle both.
  private static func extractData(from userInfo: [AnyHashable: Any]) -> [String: Any] {
    if let dict = userInfo["data"] as? [String: Any] {
      return dict
    }
    if let bodyString = userInfo["body"] as? String,
       let bodyData = bodyString.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any] {
      return parsed
    }
    if let dict = userInfo["body"] as? [String: Any] {
      return dict
    }
    return [:]
  }
}
