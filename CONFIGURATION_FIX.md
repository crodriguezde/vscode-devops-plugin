# Configuration Fix for 401 Error

## The Problem

Your VSCode settings have the organization URL incorrectly including the project name:

```json
{
  "azureDevOpsPR.organization": "https://msazure.visualstudio.com/One/"  // ❌ WRONG
}
```

## The Solution

The organization and project should be **separate** settings:

```json
{
  "azureDevOpsPR.organization": "https://msazure.visualstudio.com",  // ✅ CORRECT
  "azureDevOpsPR.project": "One",
  "azureDevOpsPR.repository": "SafeFly"
}
```

## How to Fix

1. **Open VSCode Settings:**
   - Press `Ctrl+,` (or `Cmd+,` on Mac)
   - Or go to: File → Preferences → Settings

2. **Search for "Azure DevOps PR"**

3. **Update the Organization setting:**
   - Change from: `https://msazure.visualstudio.com/One/`
   - To: `https://msazure.visualstudio.com`
   - Remove `/One/` from the end

4. **Verify Project setting:**
   - Should be set to: `One`

5. **Verify Repository setting:**
   - Should be set to: `SafeFly`

## Understanding the URL Structure

Azure DevOps URLs are structured as:
```
https://{organization}.visualstudio.com/{project}/_git/{repository}
```

In your case:
- Organization: `msazure`
- Project: `One`
- Repository: `SafeFly`

So the settings should be:
- `organization`: `https://msazure.visualstudio.com` (base URL only)
- `project`: `One`
- `repository`: `SafeFly`

## After Making Changes

1. **Sign out** (if already authenticated):
   - Open Command Palette (`Ctrl+Shift+P`)
   - Run: `Azure DevOps: Sign Out`

2. **Authenticate again:**
   - Open Command Palette (`Ctrl+Shift+P`)
   - Run: `Azure DevOps: Authenticate`
   - Choose "Personal Access Token"
   - Paste your PAT token

3. **Test the connection:**
   - Click the Azure DevOps icon in the Activity Bar
   - Click refresh
   - You should see your pull requests!

## Why This Matters

The extension constructs API URLs like this:
```
{organization}/_apis/git/repositories/{repository}/pullrequests
```

If your organization setting includes `/One/`, it becomes:
```
https://msazure.visualstudio.com/One//_apis/...  // ❌ WRONG (double slash and wrong structure)
```

With the correct setting:
```
https://msazure.visualstudio.com/_apis/git/repositories/SafeFly/pullrequests?api-version=7.0  // ✅ CORRECT
