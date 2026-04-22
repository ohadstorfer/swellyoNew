import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID')!
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY')!
const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1'
const AWS_S3_BUCKET = Deno.env.get('AWS_S3_BUCKET') || 'swellyo-videos'

// ─── AWS Signature V4 Helpers ───────────────────────────────────────────────

function hmac(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  ).then(k => crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)))
}

async function sha256(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmac(new TextEncoder().encode('AWS4' + key), dateStamp)
  const kRegion = await hmac(new Uint8Array(kDate), region)
  const kService = await hmac(new Uint8Array(kRegion), service)
  const kSigning = await hmac(new Uint8Array(kService), 'aws4_request')
  return new Uint8Array(kSigning)
}

/**
 * Generate a presigned S3 URL using AWS Signature V4
 */
async function generatePresignedUrl(
  method: 'PUT' | 'GET',
  key: string,
  expiresIn: number = 3600,
  contentType?: string,
): Promise<string> {
  const host = `${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`
  const now = new Date()
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const shortDate = dateStamp.substring(0, 8)
  const credential = `${AWS_ACCESS_KEY_ID}/${shortDate}/${AWS_REGION}/s3/aws4_request`

  const encodedKey = key.split('/').map(encodeURIComponent).join('/')

  // Build query parameters (must be sorted)
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': dateStamp,
    'X-Amz-Expires': expiresIn.toString(),
    'X-Amz-SignedHeaders': 'host',
  }

  if (method === 'PUT' && contentType) {
    params['Content-Type'] = contentType
    params['X-Amz-SignedHeaders'] = 'content-type;host'
  }

  const sortedParams = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')

  const signedHeaders = method === 'PUT' && contentType ? 'content-type;host' : 'host'
  const canonicalHeaders = method === 'PUT' && contentType
    ? `content-type:${contentType}\nhost:${host}\n`
    : `host:${host}\n`

  const canonicalRequest = [
    method,
    '/' + encodedKey,
    sortedParams,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const canonicalRequestHash = await sha256(canonicalRequest)

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateStamp,
    `${shortDate}/${AWS_REGION}/s3/aws4_request`,
    canonicalRequestHash,
  ].join('\n')

  const signingKey = await getSignatureKey(AWS_SECRET_ACCESS_KEY, shortDate, AWS_REGION, 's3')
  const signature = toHex(await hmac(signingKey, stringToSign))

  return `https://${host}/${encodedKey}?${sortedParams}&X-Amz-Signature=${signature}`
}

/**
 * Check if an object exists in S3 using a HEAD request with presigned URL
 */
async function s3ObjectExists(key: string): Promise<boolean> {
  const host = `${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`
  const now = new Date()
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const shortDate = dateStamp.substring(0, 8)
  const credential = `${AWS_ACCESS_KEY_ID}/${shortDate}/${AWS_REGION}/s3/aws4_request`

  const encodedKey = key.split('/').map(encodeURIComponent).join('/')

  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': dateStamp,
    'X-Amz-Expires': '60',
    'X-Amz-SignedHeaders': 'host',
  }

  const sortedParams = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')

  const canonicalRequest = [
    'HEAD',
    '/' + encodedKey,
    sortedParams,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const canonicalRequestHash = await sha256(canonicalRequest)
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateStamp,
    `${shortDate}/${AWS_REGION}/s3/aws4_request`,
    canonicalRequestHash,
  ].join('\n')

  const signingKey = await getSignatureKey(AWS_SECRET_ACCESS_KEY, shortDate, AWS_REGION, 's3')
  const signature = toHex(await hmac(signingKey, stringToSign))

  const url = `https://${host}/${encodedKey}?${sortedParams}&X-Amz-Signature=${signature}`

  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

// ─── Main Handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }

  try {
    // Verify auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization' }),
        { status: 401, headers: corsHeaders }
      )
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Verify the user's JWT
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token' }),
        { status: 401, headers: corsHeaders }
      )
    }

    const body = await req.json()
    const { action, userId } = body

    // Ensure userId matches authenticated user
    if (userId !== user.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'User ID mismatch' }),
        { status: 403, headers: corsHeaders }
      )
    }

    // ─── Action: get-upload-url ─────────────────────────────────────────────

    if (action === 'get-upload-url') {
      const timestamp = Date.now()
      const prefix = body.prefix || userId  // e.g., "dm/{conversationId}/{messageId}" or just userId
      const s3Key = `uploads/${prefix}/video-${timestamp}.mp4`
      const processedKey = `processed/${prefix}/video-${timestamp}_compressed.mp4`

      const uploadUrl = await generatePresignedUrl('PUT', s3Key, 3600, 'video/mp4')
      // 7-day presigned GET URL for the original, so the client can render playback
      // immediately after upload while MediaConvert is still producing the compressed version.
      const originalUrl = await generatePresignedUrl('GET', s3Key, 7 * 24 * 3600)

      console.log(`[process-profile-video-s3] Generated upload URL for: ${s3Key}`)

      return new Response(
        JSON.stringify({
          success: true,
          uploadUrl,
          s3Key,
          processedKey,
          originalUrl,
        }),
        { status: 200, headers: corsHeaders }
      )
    }

    // ─── Action: get-processed-url ──────────────────────────────────────────

    if (action === 'get-processed-url') {
      const { processedKey } = body

      if (!processedKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing processedKey' }),
          { status: 400, headers: corsHeaders }
        )
      }

      // Check if the processed file exists
      const exists = await s3ObjectExists(processedKey)

      if (!exists) {
        return new Response(
          JSON.stringify({ success: true, ready: false, message: 'Video still processing' }),
          { status: 200, headers: corsHeaders }
        )
      }

      // Generate a presigned GET URL (7 days)
      const downloadUrl = await generatePresignedUrl('GET', processedKey, 7 * 24 * 3600)

      // Only update `surfers.profile_video_url` for SURF-LEVEL (profile) uploads.
      // DM video uploads share this Edge Function but store under `processed/dm/...`
      // — those are linked to a specific message row, not to the user's profile,
      // so writing them to `surfers` would overwrite the user's real surf video.
      const isDmVideo = processedKey.startsWith('processed/dm/')

      if (!isDmVideo) {
        const { error: updateError } = await supabaseAdmin
          .from('surfers')
          .update({ profile_video_url: downloadUrl })
          .eq('user_id', userId)

        if (updateError) {
          console.error('[process-profile-video-s3] DB update failed:', updateError)
        } else {
          console.log(`[process-profile-video-s3] DB updated with processed URL for user ${userId}`)
        }
      } else {
        console.log(`[process-profile-video-s3] DM video processed — skipping surfers update for ${processedKey}`)
      }

      return new Response(
        JSON.stringify({
          success: true,
          ready: true,
          videoUrl: downloadUrl,
        }),
        { status: 200, headers: corsHeaders }
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: corsHeaders }
    )
  } catch (error) {
    console.error('[process-profile-video-s3] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: corsHeaders }
    )
  }
})
