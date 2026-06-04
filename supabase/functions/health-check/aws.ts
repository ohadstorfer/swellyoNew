const AWS_ACCESS_KEY_ID = Deno.env.get('AWS_ACCESS_KEY_ID')!
const AWS_SECRET_ACCESS_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY')!
const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1'
const AWS_S3_BUCKET = Deno.env.get('AWS_S3_BUCKET') || 'swellyo-videos'

// ─── AWS Signature V4 Helpers ───────────────────────────────────────────────

function hmac(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.importKey(
    'raw', key as unknown as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
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
export async function generatePresignedUrl(
  method: 'PUT' | 'GET',
  key: string,
  expiresIn: number = 3600,
  contentType?: string,
): Promise<string> {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) throw new Error("AWS credentials not set");
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
