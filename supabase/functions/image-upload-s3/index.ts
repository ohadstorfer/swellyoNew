// image-upload-s3 — issue presigned PUTs for profile images and trigger S3
// thumbnail generation. Mirrors process-profile-video-s3's auth pattern:
// validate the caller's JWT, reject when body.userId != token user, then
// dispatch by action. The client never sees THUMBNAIL_SECRET.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generatePresignedUrl } from "./aws.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const THUMB_SECRET = Deno.env.get("THUMBNAIL_SECRET") ?? "";
const S3_BASE = "https://swellyo-images.s3.us-east-1.amazonaws.com";

// Public buckets this fn may sign uploads for, and the allowed filename kinds.
const ALLOWED: Record<string, Set<string>> = {
  "profile-images": new Set(["profile", "cover", "video-thumbnail"]),
  "trip-images": new Set(["hero", "accommodation"]),
  "surftrip-images": new Set(["hero"]),
};

// Chat file attachments — the REAL gate. Keep in sync with the client
// allowlist in src/services/messaging/fileAttachmentPolicy.ts. Executables and
// active content are never signed, so bypassing the client yields nothing.
const FILE_ALLOWED: Set<string> = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "csv", "txt", "rtf", "zip",
  "png", "jpg", "jpeg", "gif", "webp", "heic",
  "mp3", "m4a", "wav", "mp4", "mov",
]);
const FILE_CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  rtf: "application/rtf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return json({ error: "missing token" }, 401);
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { action, userId, bucket, kind, key, filename } = body as {
      action?: string; userId?: string; bucket?: string; kind?: string; key?: string; filename?: string;
    };

    // Country cache upload — shared, keyed by filename (not userId), any
    // authenticated user (matches the old Countries-bucket RLS). No thumbnails:
    // country images are read raw, not laddered.
    if (action === "get-country-upload-url") {
      if (!filename || !/^[A-Za-z0-9 _-]+\.jpg$/.test(filename)) {
        return json({ error: "bad filename" }, 400);
      }
      const objectKey = `Countries/${filename}`;
      const uploadUrl = await generatePresignedUrl("PUT", objectKey, 3600, "image/jpeg");
      return json({ uploadUrl, key: objectKey, publicUrl: `${S3_BASE}/${objectKey}` });
    }

    // Chat image upload — public (matches the legacy public message-images
    // bucket), keyed by conversation/message. Authorize by conversation
    // membership (same check as sign-dm-video). Client uploads original.jpg +
    // thumbnail.jpg (it generates both), so no server thumbnailing.
    if (action === "get-message-upload-url") {
      const { conversationId, messageId, isThumbnail } = body as {
        conversationId?: string; messageId?: string; isThumbnail?: boolean;
      };
      if (!conversationId || !messageId) return json({ error: "bad input" }, 400);
      const { data: membership } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership) return json({ error: "not a conversation member" }, 403);
      const objectKey =
        `message-images/${conversationId}/${messageId}/${isThumbnail ? "thumbnail" : "original"}.jpg`;
      const uploadUrl = await generatePresignedUrl("PUT", objectKey, 3600, "image/jpeg");
      return json({ uploadUrl, key: objectKey, publicUrl: `${S3_BASE}/${objectKey}` });
    }

    // Chat file attachment upload — PRIVATE (message-files/ prefix is not
    // public). Allowlist-gated + membership-checked. The key is derived from the
    // message id only; the user's filename never touches the storage path.
    if (action === "get-message-file-upload-url") {
      const { conversationId, messageId, ext } = body as {
        conversationId?: string; messageId?: string; ext?: string;
      };
      if (!conversationId || !messageId || !ext) return json({ error: "bad input" }, 400);
      const e = String(ext).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!FILE_ALLOWED.has(e)) return json({ error: "file type not allowed" }, 400);
      const { data: membership } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership) return json({ error: "not a conversation member" }, 403);
      const ct = FILE_CONTENT_TYPE[e] ?? "application/octet-stream";
      const objectKey = `message-files/${conversationId}/${messageId}/file.${e}`;
      const uploadUrl = await generatePresignedUrl("PUT", objectKey, 3600, ct);
      return json({ uploadUrl, key: objectKey, contentType: ct });
    }

    // Chat file attachment download — short-lived presigned GET, membership-
    // checked. The storagePath must live under this conversation's prefix.
    if (action === "get-message-file-download-url") {
      const { conversationId, storagePath } = body as {
        conversationId?: string; storagePath?: string;
      };
      if (!conversationId || !storagePath) return json({ error: "bad input" }, 400);
      if (!storagePath.startsWith(`message-files/${conversationId}/`)) {
        return json({ error: "bad path" }, 400);
      }
      const { data: membership } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership) return json({ error: "not a conversation member" }, 403);
      const downloadUrl = await generatePresignedUrl("GET", storagePath, 900);
      return json({ downloadUrl });
    }

    if (userId !== user.id) return json({ error: "user mismatch" }, 403);

    if (action === "get-upload-url") {
      if (!bucket || !kind || !ALLOWED[bucket]?.has(kind)) {
        return json({ error: "bad bucket/kind" }, 400);
      }
      const objectKey = `${bucket}/${userId}/${kind}-${Date.now()}.jpg`;
      const uploadUrl = await generatePresignedUrl("PUT", objectKey, 3600, "image/jpeg");
      return json({ uploadUrl, key: objectKey, publicUrl: `${S3_BASE}/${objectKey}` });
    }

    if (action === "generate-thumbnails") {
      // Only ever generate for a key under this user's own folder.
      if (!key || !/^[a-z-]+\/[^/]+\//.test(key) || !key.includes(`/${userId}/`)) {
        return json({ error: "bad key" }, 400);
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-thumbnail-s3`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-thumb-secret": THUMB_SECRET },
        body: JSON.stringify({ key }),
      });
      return json(await res.json().catch(() => ({ skipped: true })));
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
