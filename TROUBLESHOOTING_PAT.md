# Troubleshooting PAT Authentication (401 Errors)

If you're receiving a **401 Authentication Failed** error when using a Personal Access Token (PAT), follow these steps to resolve the issue.

## Common Causes of 401 Errors

### 1. **Incorrect Token Permissions**

Your PAT must have the correct scopes enabled:

**Required Scopes:**
- ✅ **Code (Read & Write)** - Required for accessing pull requests
- ✅ **Work Items (Read & Write)** - Optional, for work item integration
- ✅ **Build (Read)** - Optional, for build status
- ✅ **Project and Team (Read)** - Optional, for policy checks

**How to fix:**
1. Go to Azure DevOps → Profile → Security → Personal Access Tokens
2. Find your token or create a new one
3. Ensure "Code (Read & Write)" is selected at minimum
4. Save and copy the new token
5. Run `Azure DevOps: Authenticate` in VSCode and paste the new token

### 2. **Token Has Expired**

PAT tokens expire based on the duration you set when creating them.

**How to check:**
1. Go to Azure DevOps → Profile → Security → Personal Access Tokens
2. Check the "Expires" column
3. If expired, create a new token
4. Authenticate again in VSCode with the new token

### 3. **Wrong Organization or Project Configuration**

The extension needs to know which organization and project to connect to.

**How to verify:**

Open VSCode Settings (`Ctrl+,`) and search for "Azure DevOps PR":

```json
{
  "azureDevOpsPR.organization": "https://dev.azure.com/myorg",  // ✅ Full URL format
  "azureDevOpsPR.project": "MyProject",                          // ✅ Exact project name
  "azureDevOpsPR.repository": "MyRepo"                           // ✅ Exact repo name
}
```

**Common mistakes:**
- ❌ `"organization": "myorg"` → Should be: `"https://dev.azure.com/myorg"` or `"https://myorg.visualstudio.com"`
- ❌ `"project": "my project"` → Should match exact casing and spelling

**Supported URL formats:**
- ✅ New format: `"https://dev.azure.com/myorg"`
- ✅ Legacy format: `"https://myorg.visualstudio.com"` (also supported)
- ✅ Just org name: `"myorg"` (will use new format automatically)

### 4. **Token Copied Incorrectly**

Sometimes tokens get corrupted when copying from the browser.

**How to fix:**
1. Go back to Azure DevOps and create a fresh token
2. Click the copy button (don't manually select and copy)
3. In VSCode, run `Azure DevOps: Sign Out` first
4. Run `Azure DevOps: Authenticate` 
5. Paste the token carefully (Ctrl+V)
6. The extension now validates token format before saving

### 5. **Token Missing Required Organization Access**

Your PAT must have access to the specific organization you're trying to use.

**How to fix:**
1. When creating a PAT, ensure you select the correct organization
2. If using multiple organizations, create separate tokens for each
3. The "Organization" dropdown when creating the PAT must match your settings

## Step-by-Step Resolution

Follow these steps in order:

### Step 1: Verify Your Configuration

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type: `Preferences: Open Settings (JSON)`
3. Verify these settings exist and are correct:

```json
{
  "azureDevOpsPR.organization": "https://dev.azure.com/YOUR_ORG_NAME",
  "azureDevOpsPR.project": "YOUR_PROJECT_NAME",
  "azureDevOpsPR.repository": "YOUR_REPO_NAME",
  "azureDevOpsPR.authenticationMethod": "pat"
}
```

### Step 2: Create a New PAT Token

1. Go to: `https://dev.azure.com/YOUR_ORG_NAME/_usersSettings/tokens`
2. Click **"+ New Token"**
3. Configure:
   - **Name**: "VSCode PR Viewer"
   - **Organization**: Select your organization
   - **Expiration**: 90 days (or your preference)
   - **Scopes**: Select "Code (Read & Write)"
4. Click **"Create"**
5. **IMMEDIATELY COPY** the token (you can't see it again!)

### Step 3: Clear Old Authentication

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run: `Azure DevOps: Sign Out`
3. This clears any cached credentials

### Step 4: Authenticate with New Token

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run: `Azure DevOps: Authenticate`
3. Choose: **"Personal Access Token"**
4. Paste your new token
5. You should see: "PAT saved successfully!"

### Step 5: Test Connection

1. Click the Azure DevOps icon in the Activity Bar (left sidebar)
2. Click the refresh button in the Pull Requests view
3. If successful, you'll see your pull requests

## Still Getting 401 Errors?

### Enable Debug Output

1. Open Output panel: `View → Output` or `Ctrl+Shift+U`
2. Select "Azure DevOps PR Viewer" from the dropdown
3. Look for detailed error messages

### Check Network/Proxy Issues

If you're behind a corporate proxy:
1. Ensure VSCode proxy settings are configured
2. Check `http.proxy` and `http.proxyStrictSSL` settings
3. Some corporate networks block Azure DevOps API calls

### Verify Repository Access

Make sure you have access to the repository:
1. Try accessing it in a browser: `https://dev.azure.com/ORG/PROJECT/_git/REPO`
2. If you can't access it in browser, you won't be able to via API

### Try OAuth Instead

If PAT continues to fail, try OAuth authentication:
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run: `Azure DevOps: Authenticate`
3. Choose: **"GitHub Account (OAuth)"**
4. Follow the browser-based authentication flow

## Testing Your PAT Token Manually

You can test your PAT token using curl:

```bash
# Replace YOUR_PAT_TOKEN with your actual token
# Replace ORG, PROJECT, REPO with your values

curl -u :YOUR_PAT_TOKEN https://dev.azure.com/ORG/PROJECT/_apis/git/repositories/REPO/pullrequests?api-version=7.0
```

If this works, the issue is with the extension configuration.
If this fails with 401, the issue is with your token or permissions.

## Additional Resources

- [Azure DevOps PAT Documentation](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
- [Azure DevOps REST API](https://docs.microsoft.com/en-us/rest/api/azure/devops/)
- [Extension Settings Guide](./AUTHENTICATION_GUIDE.md)

## Need More Help?

If none of these steps work:
1. Check the extension's GitHub issues
2. Create a new issue with:
   - Error message from Output panel
   - Your VSCode version
   - Your settings (with sensitive info removed)
   - Steps you've already tried
