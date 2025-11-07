# CI/CD Quick Start Guide

Get your CI/CD pipeline up and running in 5 minutes.

## Prerequisites

- GitHub repository with the extension code
- Access to repository settings
- Azure DevOps account (for marketplace publishing)

## Step-by-Step Setup

### 1. Create Marketplace Publisher (First Time Only)

If you haven't published to VSCode Marketplace before:

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with your Microsoft account
3. Click "Create publisher"
4. Fill in publisher details:
   - **ID:** `crodriguezde` (or your chosen ID)
   - **Display name:** Your name or organization
   - **Description:** Brief description
5. Click "Create"

### 2. Generate Marketplace Token

1. Visit https://dev.azure.com/crodriguezde/_usersSettings/tokens
   - Replace `crodriguezde` with your Azure DevOps organization
2. Click "+ New Token"
3. Configure token:
   - **Name:** `VSCode Marketplace Publishing`
   - **Organization:** All accessible organizations
   - **Expiration:** 1 year (recommended)
   - **Scopes:** 
     - ✅ **Marketplace** → **Acquire**
     - ✅ **Marketplace** → **Publish**
4. Click "Create"
5. **Important:** Copy the token immediately (shown only once)

### 3. Add GitHub Secret

1. Go to your GitHub repository
2. Navigate to: `Settings` → `Secrets and variables` → `Actions`
3. Click "New repository secret"
4. Add secret:
   - **Name:** `VSCE_PAT`
   - **Value:** Paste the token from step 2
5. Click "Add secret"

### 4. Verify Configuration

Check your `package.json`:

```json
{
  "name": "azure-devops-pr-viewer",
  "publisher": "crodriguezde",  // ← Must match your publisher ID
  "version": "0.1.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/crodriguezde/vscode-devops-plugin"  // ← Your repo
  }
}
```

### 5. Test CI Pipeline

Push code or create a PR to trigger the CI workflow:

```bash
git add .
git commit -m "Setup CI/CD pipeline"
git push origin main
```

Watch the workflow:
1. Go to your repository
2. Click "Actions" tab
3. You should see "CI" workflow running

### 6. Create Your First Release

When ready to release version 0.1.0:

```bash
# Ensure you're on main branch with latest code
git checkout main
git pull

# Create and push version tag
git tag v0.1.0
git push origin v0.1.0
```

Watch the release:
1. Go to "Actions" tab
2. "Release" workflow should start automatically
3. After completion, check:
   - GitHub Releases page (VSIX file attached)
   - VSCode Marketplace (extension published)

## Verification Checklist

After setup, verify:

- [ ] CI workflow runs on PR/push
- [ ] Build passes without errors
- [ ] VSIX artifact is generated
- [ ] Release workflow triggers on tag
- [ ] GitHub release is created
- [ ] Extension appears on marketplace

## Common Issues

### Issue: "VSCE_PAT is not set"

**Solution:** Verify the secret name is exactly `VSCE_PAT` (case-sensitive)

### Issue: "Publisher not found"

**Solution:** Ensure `package.json` publisher matches your marketplace publisher ID

### Issue: "Token expired"

**Solution:** Generate a new token and update the GitHub secret

### Issue: "Build fails on npm ci"

**Solution:** Delete `package-lock.json` locally, run `npm install`, commit and push

## Next Steps

- Read [RELEASE.md](.github/RELEASE.md) for detailed documentation
- Set up branch protection rules
- Configure automated testing
- Add status badges to README

## Quick Commands

```bash
# Test build locally
npm ci
npm run compile
npm run lint
npm run package

# Create stable release
git tag v1.0.0
git push origin v1.0.0

# Create pre-release
git tag v1.0.0-beta.1
git push origin v1.0.0-beta.1

# Delete a tag (if needed)
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
```

## Support

- Check workflow logs in Actions tab
- Review [RELEASE.md](.github/RELEASE.md) for troubleshooting
- Verify secrets in repository settings
- Test locally before tagging

## Status Badges (Optional)

Add to your README.md:

```markdown
![CI](https://github.com/crodriguezde/vscode-devops-plugin/workflows/CI/badge.svg)
![Release](https://github.com/crodriguezde/vscode-devops-plugin/workflows/Release/badge.svg)
```

---

**Ready to release?** Just tag and push! The pipeline handles the rest. 🚀
