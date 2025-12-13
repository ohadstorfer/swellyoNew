# Fix: OpenAI Model JSON Mode Error

## The Error

```
Invalid parameter: 'response_format' of type 'json_object' is not supported with this model.
```

## The Problem

The Edge Function is using `gpt-4` which **doesn't support** `response_format: { type: 'json_object' }`.

## The Solution

I've updated the Edge Function to use `gpt-4o` which supports JSON mode.

### Models That Support JSON Mode:
- ✅ `gpt-4o` (recommended - latest)
- ✅ `gpt-4-turbo`
- ✅ `gpt-4-0125-preview`
- ✅ `gpt-3.5-turbo-1106`
- ❌ `gpt-4` (base model - does NOT support JSON mode)

## What I Changed

Updated `supabase/functions/swelly-chat/index.ts`:
- Changed `model: 'gpt-4'` → `model: 'gpt-4o'`

## Next Steps

1. **Redeploy the Edge Function:**
   ```bash
   supabase functions deploy swelly-chat
   ```

2. **If you don't have access to `gpt-4o`:**
   - You can change it to `gpt-4-turbo` or `gpt-4-0125-preview`
   - Or remove `response_format` and parse JSON manually (not recommended)

3. **Test again** - The error should be resolved.

## Alternative: Remove JSON Mode (Not Recommended)

If you want to keep using `gpt-4`, you can remove the `response_format` parameter and parse JSON manually:

```typescript
body: JSON.stringify({
  model: 'gpt-4',
  messages: messages,
  max_tokens: 500,
  temperature: 0.7,
  // Remove response_format
})
```

Then in the parsing logic, you'd need to extract JSON from the text response, which is less reliable.

## Cost Note

- `gpt-4o` is generally cheaper than `gpt-4-turbo`
- `gpt-4o` is faster and more capable
- Recommended to use `gpt-4o` if available



