# Debugging Guide for 401 Authentication Error

## Current Status

Your settings are correct:
```json
{
  "azureDevOpsPR.organization": "https://msazure.visualstudio.com",
  "azureDevOpsPR.project": "One",
  "azureDevOpsPR.repository": "SafeFly",
  "azureDevOpsPR.authenticationMethod": "pat"
}
```

## Steps to Debug

### 1. Run Extension in Debug Mode

1. Press **F5** in VSCode (or Run → Start Debugging)
2. This will open a new "Extension Development Host" window
3. In the new window, open the Command Palette (Ctrl+Shift+P)
4. Run: `Azure DevOps: Authenticate`
5. Enter your PAT token

### 2. Check Debug Console

1. Go back to your main VSCode window (where you're developing)
2. Open the Debug Console: **View → Debug Console**
3. Look for the console.log output that shows:
   ```
   Getting PRs with config: { repository: 'SafeFly', project: 'One', organization: 'https://msazure.visualstudio.com' }
   ```

### 3. Check for Error Message

The error message will now show the exact repository and project being used:
```
Failed to get pull requests: [error message]
Repository: SafeFly, Project: One
```

## What to Look For

### Expected Output (Success)
```
Getting PRs with config: {
  repository: 'SafeFly',
  project: 'One',
  organization: 'https://msazure.visualstudio.com'
}
```

### Common Error Patterns

**Error 1: "A project name is required"**
- This means the `azure-devops-node-api` isn't receiving the project parameter correctly
- Solution: We may need to use repository ID instead of name

**Error 2: "TF401019: The Git repository with name or identifier SafeFly does not exist"**
- This means the repository name is wrong or the library needs the repository ID
- Solution: Get the repository ID from the API

**Error 3: "VS403403: The current user does not have permissions"**
- PAT token doesn't have correct permissions
- Solution: Create new PAT with "Code (Read & Write)" scope

## Next Steps

After seeing the debug output, we can:

1. **If repository name is the issue**: Get the repository ID by calling:
   ```bash
   curl -u :YOUR_PAT "https://msazure.visualstudio.com/One/_apis/git/repositories?api-version=7.0"
   ```
   
2. **If it's a different error**: Share the exact error message so we can fix it

## Alternative: Manual API Test

Test if the API works with your current config:

```bash
# Test getting repositories
curl -u :YOUR_PAT "https://msazure.visualstudio.com/One/_apis/git/repositories?api-version=7.0"

# Test getting pull requests (replace REPO_ID with the ID from above)
curl -u :YOUR_PAT "https://msazure.visualstudio.com/One/_apis/git/repositories/REPO_ID/pullrequests?api-version=7.0"
```

If the manual curl commands work but the extension doesn't, then we know it's an issue with how the `azure-devops-node-api` library is being called.
