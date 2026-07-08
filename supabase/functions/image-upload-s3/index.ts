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
