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

    let data = Self.extractData(from: request.content.userInfo)

    let senderName = (data["senderName"] as? String) ?? bestAttempt.title
    let senderId = (data["senderId"] as? String) ?? senderName
    let conversationId = data["conversationId"] as? String
    let isGroup = (data["isGroup"] as? Bool) ?? false
    let groupName = data["groupName"] as? String
    let messageText = (data["message"] as? String) ?? bestAttempt.body
    let avatarUrl = data["avatarUrl"] as? String

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
        // iOS only renders this as a GROUP (group name + group image) when the
        // intent has >= 2 recipients. With `recipients: nil` it degrades to a
        // 1:1 and shows the sender name + no image (the app icon). We don't have
        // the member list in the extension, so pass the sender + a "You"
        // placeholder; `speakableGroupName` takes precedence over recipient
        // names, so the group name is what's shown.
        let me = INPerson(
          personHandle: INPersonHandle(value: "swellyo-self", type: .unknown),
          nameComponents: nil,
          displayName: "You",
          image: nil,
          contactIdentifier: nil,
          customIdentifier: nil
        )
        intent = INSendMessageIntent(
          recipients: [sender, me],
          outgoingMessageType: .outgoingMessageText,
          content: messageText,
          speakableGroupName: speakable,
          conversationIdentifier: conversationId,
          serviceName: nil,
          sender: sender,
          attachments: nil
        )
        // For groups the big thumbnail is the GROUP image (sender image is never
        // shown for groups — it must go on speakableGroupName).
        if let img = avatarImage {
          intent.setImage(img, forParameterNamed: \.speakableGroupName)
        }
      } else {
        // 1:1 DM — recipients nil so iOS renders a clean WhatsApp-style header
        // (sender avatar + sender name + message) with NO "To you & …" line.
        intent = INSendMessageIntent(
          recipients: nil,
          outgoingMessageType: .outgoingMessageText,
          content: messageText,
          speakableGroupName: nil,
          conversationIdentifier: conversationId,
          serviceName: nil,
          sender: sender,
          attachments: nil
        )
        // Pin the sender photo as the notification avatar.
        if let img = avatarImage {
          intent.setImage(img, forParameterNamed: \.sender)
        }
      }

      let interaction = INInteraction(intent: intent, response: nil)
      interaction.direction = .incoming
      interaction.donate { _ in }

      do {
        let updated = try bestAttempt.updating(from: intent)
        contentHandler(updated)
      } catch {
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
