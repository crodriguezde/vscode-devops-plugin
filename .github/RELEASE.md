# Release Process

This document describes the CI/CD pipeline and release process for the Azure DevOps PR Viewer extension.

## Overview

The project uses GitHub Actions for automated CI/CD with three main workflows:

1. **CI (Continuous Integration)** - Runs on PRs and pushes
2. **Release** - Publishes stable releases
3. **Pre-Release** - Publishes beta/alpha versions

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CI/CD Workflows                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  PR/Push → CI Workflow                                  │
│    ├─ Build (Node 18.x & 20.x)                         │
│    ├─ Lint                                              │
│    ├─ Test                                              │
│    ├─ Package VSIX                                      │
│    └─ Upload Artifact                                   │
│                                                          │
│  Tag v*.*.* → Release Workflow                          │
│    ├─ Build & Test                                      │
│    ├─ Package VSIX                                      │
│    ├─ Create GitHub Release                             │
│    └─ Publish to VS Marketplace                         │
│                                                          │
│  Tag v*.*.*-beta.* → Pre-Release Workflow               │
│    ├─ Build & Test                                      │
│    ├─ Package VSIX                                      │
│    └─ Create GitHub Pre-Release                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Workflows

### 1. CI Workflow (`.github/workflows/ci.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

**Jobs:**
- **Build:** Tests on Node.js 18.x and 20.x
  - Checkout code
  - Install dependencies
  - Compile TypeScript
  - Run linting
  - Run tests
  - Package extension
  - Upload VSIX artifact (Node 20.x only)

- **Code Quality:** Security and dependency checks
  - Vulnerability scanning
  - Outdated package detection

### 2. Release Workflow (`.github/workflows/release.yml`)

**Triggers:**
- Git tags matching `v*.*.*` (e.g., `v1.0.0`, `v2.1.3`)

**Steps:**
1. Build and test extension
2. Extract version from tag
3. Update `package.json` version
4. Package VSIX file
5. Generate changelog from commits
6. Create GitHub Release with VSIX attachment
7. Publish to VSCode Marketplace

**Requirements:**
- `VSCE_PAT` secret must be configured
- Tag must follow semantic versioning

### 3. Pre-Release Workflow (`.github/workflows/pre-release.yml`)

**Triggers:**
- Git tags matching:
  - `v*.*.*-beta.*` (e.g., `v1.0.0-beta.1`)
  - `v*.*.*-alpha.*` (e.g., `v1.0.0-alpha.2`)
  - `v*.*.*-rc.*` (e.g., `v1.0.0-rc.1`)

**Steps:**
1. Build and test extension
2. Extract version from tag
3. Package VSIX file
4. Create GitHub Pre-Release with VSIX attachment

**Note:** Pre-releases are NOT published to the marketplace.

## Setup Instructions

### 1. Configure GitHub Secrets

Navigate to your repository settings: `Settings` → `Secrets and variables` → `Actions`

Add the following secret:

#### `VSCE_PAT` (Required for releases)

A Personal Access Token for publishing to the VSCode Marketplace.

**How to create:**

1. Go to https://dev.azure.com/crodriguezde/_usersSettings/tokens
2. Click "New Token"
3. Configure:
   - **Name:** `VSCode Marketplace Publishing`
   - **Organization:** `All accessible organizations`
   - **Expiration:** Custom (1 year recommended)
   - **Scopes:** 
     - ✅ Marketplace (Acquire)
     - ✅ Marketplace (Publish)
4. Click "Create"
5. Copy the token immediately (it won't be shown again)
6. Add to GitHub secrets as `VSCE_PAT`

### 2. Update Repository URL

Update `package.json` with your repository URL:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/crodriguezde/vscode-devops-plugin"
  }
}
```

### 3. Verify Publisher

Ensure `package.json` has the correct publisher name:

```json
{
  "publisher": "crodriguezde"
}
```

If you haven't created a publisher on the marketplace yet:
1. Visit https://marketplace.visualstudio.com/manage
2. Create a publisher ID
3. Update `package.json` with your publisher ID

## Creating a Release

### Stable Release

1. **Ensure code is ready:**
   ```bash
   npm run compile
   npm run lint
   npm run test
   ```

2. **Create and push a version tag:**
   ```bash
   # Example: version 1.0.0
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. **Monitor the workflow:**
   - Go to Actions tab in GitHub
   - Watch the "Release" workflow
   - Check for any errors

4. **Verify release:**
   - Check GitHub Releases page
   - Verify VSIX file is attached
   - Check VSCode Marketplace for published extension

### Pre-Release (Beta/Alpha)

1. **Create and push a pre-release tag:**
   ```bash
   # Beta release
   git tag v1.0.0-beta.1
   git push origin v1.0.0-beta.1

   # Alpha release
   git tag v1.0.0-alpha.1
   git push origin v1.0.0-alpha.1

   # Release candidate
   git tag v1.0.0-rc.1
   git push origin v1.0.0-rc.1
   ```

2. **Monitor the workflow:**
   - Go to Actions tab
   - Watch the "Pre-Release" workflow

3. **Share with testers:**
   - Download VSIX from GitHub Pre-Release
   - Install manually in VSCode

**Note:** Pre-releases are NOT automatically published to the marketplace.

## Version Management

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version (X.0.0): Incompatible API changes
- **MINOR** version (0.X.0): New functionality, backwards compatible
- **PATCH** version (0.0.X): Bug fixes, backwards compatible

### Version Examples

- `v1.0.0` - Stable release
- `v1.1.0` - New features
- `v1.1.1` - Bug fixes
- `v2.0.0-beta.1` - Beta version of major update
- `v2.0.0-alpha.1` - Alpha version
- `v2.0.0-rc.1` - Release candidate

## Rollback Process

If a release has issues:

### Option 1: Quick Fix Release

1. Fix the issue in code
2. Create a new patch version tag:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

### Option 2: Unpublish from Marketplace

**Warning:** Unpublishing removes the extension for all users.

```bash
npx vsce unpublish <publisher>.<extension-name>
```

### Option 3: Deprecate Version

1. Go to marketplace.visualstudio.com/manage
2. Mark the version as deprecated
3. Upload a new version

## Manual Publishing

If you need to publish manually:

```bash
# Package the extension
npm run package

# Publish to marketplace
npm run publish
```

Or using vsce directly:

```bash
# Login to marketplace
npx vsce login <publisher>

# Publish
npx vsce publish
```

## Troubleshooting

### Build Failures

1. Check the Actions tab for error logs
2. Verify `package.json` scripts are correct
3. Ensure all dependencies are in `package.json`
4. Test locally: `npm ci && npm run compile && npm run package`

### Publishing Failures

1. Verify `VSCE_PAT` secret is set correctly
2. Check token hasn't expired
3. Ensure token has correct permissions (Marketplace Publish)
4. Verify publisher ID in `package.json` matches marketplace

### Tag Issues

```bash
# List all tags
git tag -l

# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin :refs/tags/v1.0.0

# Create new tag
git tag v1.0.0
git push origin v1.0.0
```

## Best Practices

1. **Always test before releasing:**
   - Run full test suite
   - Test extension locally
   - Verify on different Node versions

2. **Use meaningful commit messages:**
   - They appear in the auto-generated changelog
   - Follow conventional commits format

3. **Tag from main branch:**
   - Ensure main branch is stable
   - Merge all features before tagging

4. **Document breaking changes:**
   - Update README.md
   - Add migration guide if needed

5. **Monitor after release:**
   - Check marketplace stats
   - Watch for user issues
   - Monitor GitHub issues

## CI/CD Metrics

Track these metrics for pipeline health:

- Build success rate
- Average build time
- Time from commit to release
- Number of rollbacks
- Test coverage percentage

## Additional Resources

- [VSCode Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)
- [vsce CLI Documentation](https://github.com/microsoft/vscode-vsce)
