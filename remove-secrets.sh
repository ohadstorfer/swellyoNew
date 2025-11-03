#!/bin/bash
# Remove secrets from git history
# This will rewrite the commit that contains the secrets

# Find the commit with secrets
COMMIT_WITH_SECRETS="9116c14f624afa60cbc7f932f42ec86d88a78aae"

# Use git filter-branch to remove the secrets
git filter-branch --force --env-filter '
    # Remove the secrets from the commit
    if [ "$GIT_COMMIT" = "'"$COMMIT_WITH_SECRETS"'" ]; then
        # This will rewrite the commit
        export GIT_COMMITTER_DATE="$GIT_COMMITTER_DATE"
        export GIT_AUTHOR_DATE="$GIT_AUTHOR_DATE"
    fi
' --index-filter '
    # Remove the file from the index if it contains secrets, then add it back with clean version
    git checkout HEAD -- src/utils/simpleAuthService.ts 2>/dev/null || true
' --prune-empty --tag-name-filter cat -- --all

