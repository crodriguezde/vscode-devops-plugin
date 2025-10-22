# Azure DevOps PR Viewer - Authentication Guide

This extension now supports **two authentication methods** to connect to Azure DevOps:

## 🎯 Recommended: OAuth (GitHub Account)

**Benefits:**
- ✅ No need to create or manage PAT tokens
- ✅ More secure - uses your GitHub account
- ✅ Automatic token refresh
- ✅ One-click sign in
- ✅ Easy to revoke access

### How to Use OAuth:

1. **Install the extension** and reload VSCode
2. **Open Command Palette** (`Ctrl+Shift+P`)
3. **Run:** `Azure DevOps: Authenticate`
4. **Choose:** "GitHub Account (OAuth)" from the menu
5. **Sign in** with your GitHub account in the browser window that opens
6. **Grant permissions** when prompted
7. **Done!** You're authenticated

### First Time Setup:

After authenticating, configure your organization and project:

1. Open **Settings** (`Ctrl+,`)
2. Search for "Azure DevOps PR"
3. Set these values:
   - `azureDevOpsPR.organization`: `https://dev.azure.com/yourorg`
   - `azureDevOpsPR.project`: `YourProjectName`
   - `azureDevOpsPR.repository`: `YourRepoName` (optional)

4. **Click the Azure DevOps icon** in the Activity Bar to see your PRs!

---

## 🔑 Alternative: Personal Access Token (PAT)

If you prefer or need to use a PAT token:

### Creating a PAT:

1. Go to your **Azure DevOps** organization
2. Click your **profile picture** (top right) → **Security**
3. Select **Personal Access Tokens**
4. Click **+ New Token**
5. Configure the token:
   - **Name:** "VSCode PR Viewer"
   - **Organization:** Select your organization
   - **Expiration:** Choose a duration (90 days recommended)
   - **Scopes:** Select these:
     - ✅ **Code (Read & Write)**
     - ✅ **Work Items (Read & Write)** (for work item integration)
     - ✅ **Build (Read)** (for build status)
     - ✅ **Project and Team (Read)** (for policy checks)
6. Click **Create**
7. **Copy the token immediately** (you won't be able to see it again!)

### Using Your PAT:

1. **Open Command Palette** (`Ctrl+Shift+P`)
2. **Run:** `Azure DevOps: Authenticate`
3. **Choose:** "Personal Access Token" from the menu
4. **Paste your PAT** in the input box
5. **Press Enter**

### Security Notes:
- PATs are stored securely in VSCode's secret storage
- Never commit PATs to source control
- Set reasonable expiration dates
- Revoke unused PATs regularly

---

## 🔄 Switching Between Methods

You can easily switch between OAuth and PAT:

1. **Open Settings** (`Ctrl+,`)
2. Search for `azureDevOpsPR.authenticationMethod`
3. Choose:
   - `oauth` - Use Microsoft Account (recommended)
   - `pat` - Use Personal Access Token

Or just run `Azure DevOps: Authenticate` again and choose a different method.

---

## 🚪 Sign Out

To sign out:

1. **Open Command Palette** (`Ctrl+Shift+P`)
2. **Run:** `Azure DevOps: Sign Out`

This will clear both OAuth session and any stored PAT.

---

## ❓ Troubleshooting

### "No authentication token found" error

**Solution:** You need to authenticate first!
1. Run `Azure DevOps: Authenticate`
2. Choose your preferred method
3. Complete the authentication flow

### OAuth sign-in window doesn't open

**Solution:** 
- Check if pop-ups are blocked in your browser
- Try running the command again
- Fall back to PAT method if OAuth continues to fail

### PAT authentication fails

**Possible causes:**
- Token expired - create a new one
- Wrong permissions - ensure "Code (Read & Write)" is selected
- Token already revoked - check Azure DevOps Security settings

### "Organization/Project not found" error

**Solution:** Check your settings:
```json
{
  "azureDevOpsPR.organization": "https://dev.azure.com/myorg",  // Must include full URL
  "azureDevOpsPR.project": "MyProject",  // Exact project name
  "azureDevOpsPR.repository": "MyRepo"   // Exact repo name
}
```

---

## 🎓 Which Method Should I Use?

| Feature | OAuth | PAT |
|---------|-------|-----|
| Ease of use | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Security | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Setup time | 30 seconds | 2 minutes |
| Token management | Automatic | Manual |
| Expiration | Never | Configurable |
| CI/CD friendly | ❌ | ✅ |

**Recommendation:**
- **Personal use:** OAuth (GitHub Account)
- **Automated scripts/CI:** PAT

---

## 🔒 Security Best Practices

1. **For OAuth:**
   - Only grant permissions when prompted by official GitHub login
   - Review connected apps periodically in your GitHub settings
   - Sign out when using shared computers

2. **For PAT:**
   - Use minimum required scopes
   - Set reasonable expiration dates (30-90 days)
   - Store tokens securely (never in code or config files)
   - Rotate tokens regularly
   - Revoke unused tokens immediately

---

## 📚 Additional Resources

- [Azure DevOps PAT Documentation](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
- [OAuth in Azure DevOps](https://docs.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth)
- [VSCode Authentication API](https://code.visualstudio.com/api/references/vscode-api#authentication)

---

**Need help?** Open an issue on GitHub or check the main README.md
