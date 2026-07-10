import SwiftUI

/// In-sheet recents picker. Deliberately dumb: it renders SharedStore's cached
/// list, one tap selects, Send fires SendClient; on failure it hands off to
/// `onFallback` (stage the payload + open the app).
///
/// Avatar thumbnails only — the cache stores 96px URLs. The extension's jetsam
/// budget is ~120 MB and full-size images will blow through it.
struct ShareView: View {
    let conversations: [SharedStore.RecentConversation]
    /// One line describing what is being shared, e.g. "Contact · Dana Cohen".
    let previewLine: String
    let onSend: (SharedStore.RecentConversation) async throws -> Void
    let onFallback: () -> Void
    let onCancel: () -> Void

    @State private var selected: SharedStore.RecentConversation?
    @State private var sending = false
    @State private var errorText: String?

    private let accent = Color(red: 0x05 / 255, green: 0xBC / 255, blue: 0xD3 / 255)

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Text(previewLine)
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.top, 8)

                List(conversations) { convo in
                    Button {
                        selected = convo
                    } label: {
                        HStack(spacing: 12) {
                            avatar(for: convo)
                            Text(convo.title)
                                .font(.body)
                                .foregroundColor(.primary)
                                .lineLimit(1)
                            Spacer()
                            if selected?.id == convo.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(accent)
                            }
                        }
                    }
                    .disabled(sending)
                }
                .listStyle(.plain)

                if let errorText {
                    Text(errorText)
                        .font(.footnote)
                        .foregroundColor(.red)
                        .padding(.bottom, 4)
                }

                Button(action: send) {
                    Text(sending ? "Sending…" : "Send")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .disabled(selected == nil || sending)
                .background(selected == nil || sending ? Color(.systemGray4) : accent)
                .foregroundColor(.white)
                .cornerRadius(12)
                .padding()
            }
            .navigationTitle("Share to Swellyo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel).disabled(sending)
                }
            }
        }
        .navigationViewStyle(.stack)
    }

    @ViewBuilder
    private func avatar(for convo: SharedStore.RecentConversation) -> some View {
        let placeholder = Circle()
            .fill(Color(.systemGray5))
            .overlay(
                Image(systemName: convo.isDirect ? "person.fill" : "person.3.fill")
                    .foregroundColor(.white)
                    .font(.system(size: 14))
            )

        if let raw = convo.avatarUrl, let url = URL(string: raw) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFill()
                default: placeholder
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(Circle())
        } else {
            placeholder.frame(width: 40, height: 40)
        }
    }

    private func send() {
        guard let convo = selected, !sending else { return }
        sending = true
        errorText = nil
        Task {
            do {
                try await onSend(convo)
                // onSend completes the extension request; nothing to do here.
            } catch {
                // Don't strand the share. Surface briefly, then let the app finish it.
                await MainActor.run {
                    sending = false
                    errorText = "Couldn’t send — opening Swellyo…"
                }
                try? await Task.sleep(nanoseconds: 800_000_000)
                await MainActor.run { onFallback() }
            }
        }
    }
}
