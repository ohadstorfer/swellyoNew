# Create New OAuth Client

## Steps to create a new OAuth 2.0 Client ID:

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Navigate to**: APIs & Services → Credentials
3. **Click**: "+ CREATE CREDENTIALS" → "OAuth 2.0 Client ID"
4. **Application type**: Web application
5. **Name**: "Swellyo Web Client"
6. **Authorized JavaScript origins**:
   ```
   http://localhost:8080
   http://localhost:8081
   http://127.0.0.1:8080
   http://127.0.0.1:8081
   ```
7. **Authorized redirect URIs**: Leave empty (not needed for GSI)
8. **Click**: CREATE

## After creating, update the client ID in:
- `src/utils/authService.ts` (line 81)
- `debug-oauth.html` (line 25)
- `test-oauth-config.html` (line 8)

## OAuth Consent Screen Configuration:
1. **Go to**: APIs & Services → OAuth consent screen
2. **User Type**: External (unless you have Google Workspace)
3. **App name**: "Swellyo"
4. **User support email**: Your email
5. **Developer contact**: Your email
6. **Scopes**: Add `openid`, `email`, `profile`
7. **Test users**: Add your email (`mtnrabi@gmail.com`)
