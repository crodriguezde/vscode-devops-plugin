# Azure DevOps PR Viewer

A VSCode extension for visualizing and interacting with Azure DevOps Pull Requests directly in your editor.

## Features

- **View Pull Requests**: Browse all active PRs in your repository
- **PR Details**: View comprehensive PR information including:
  - Title, description, and metadata
  - Source and target branches
  - Reviewers and their vote status
  - File changes with syntax highlighting
  - Comment threads
- **File Navigation**: Browse and view changed files in PR
- **Comments**: View and add comments to PRs
- **PR Actions**: Approve, complete, or abandon PRs from VSCode
- **Branch Checkout**: Quickly checkout PR source branches
- **Real-time Updates**: Refresh PRs on demand

## Prerequisites

- VSCode 1.75.0 or higher
- An Azure DevOps account with access to your repository
- A Personal Access Token (PAT) with Code (Read & Write) permissions

## Installation

1. Install the extension from the VSCode marketplace (when published)
2. Or install from VSIX:
   ```bash
   code --install-extension azure-devops-pr-viewer-0.1.0.vsix
   ```

## Configuration

1. Open VSCode Settings (Ctrl+,)
2. Search for "Azure DevOps PR"
3. Configure the following settings:

```json
{
  "azureDevOpsPR.organization": "https://dev.azure.com/yourorg",
  "azureDevOpsPR.project": "YourProject",
  "azureDevOpsPR.repository": "YourRepo",
  "azureDevOpsPR.autoRefresh": true,
  "azureDevOpsPR.refreshInterval": 300
}
```

### Settings

- `azureDevOpsPR.organization`: Your Azure DevOps organization URL (e.g., https://dev.azure.com/myorg)
- `azureDevOpsPR.project`: Project name
- `azureDevOpsPR.repository`: Repository name (optional - auto-detects from git if not specified)
- `azureDevOpsPR.autoRefresh`: Automatically refresh PRs on activation (default: true)
- `azureDevOpsPR.refreshInterval`: Auto-refresh interval in seconds (default: 300)

## Getting Started

### 1. Authenticate

1. Open the Command Palette (Ctrl+Shift+P)
2. Run: `Azure DevOps: Authenticate`
3. Enter your Personal Access Token

**Creating a PAT:**
1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Create a new token with "Code (Read & Write)" scope
3. Copy the token and paste it when prompted

### 2. View Pull Requests

1. Click the Azure DevOps icon in the Activity Bar
2. The "Pull Requests" view will show all active PRs
3. Click on a PR to view its details

### 3. Work with PRs

**View PR Details:**
- Click on a PR in the tree view
- Use Command Palette: `Azure DevOps: View PR Details`

**Browse Files:**
- The "PR Files" view shows all changed files
- Click a file to view its content
- Files are color-coded by change type (Added/Modified/Deleted)

**View Comments:**
- The "Comments" view shows all comment threads
- Expand threads to see individual comments
- Comments are organized by file

**Add Comments:**
- Right-click on a file in the PR Files view
- Select "Azure DevOps: Add Comment"
- Enter your comment text

**Approve PR:**
- Click on a PR and use Command Palette: `Azure DevOps: Approve PR`

**Complete PR:**
- Click on a PR and use Command Palette: `Azure DevOps: Complete PR`

**Checkout Branch:**
- Click on a PR and use Command Palette: `Azure DevOps: Checkout PR Branch`

## Commands

All commands are available via Command Palette (Ctrl+Shift+P):

- `Azure DevOps: Authenticate` - Authenticate with Azure DevOps
- `Azure DevOps: Refresh Pull Requests` - Refresh the PR list
- `Azure DevOps: Open Pull Request` - Open selected PR
- `Azure DevOps: View PR Details` - View detailed PR information
- `Azure DevOps: View File` - View selected file content
- `Azure DevOps: Add Comment` - Add comment to PR
- `Azure DevOps: Approve PR` - Approve the PR
- `Azure DevOps: Complete PR` - Complete (merge) the PR
- `Azure DevOps: Abandon PR` - Abandon the PR
- `Azure DevOps: Checkout PR Branch` - Checkout the PR source branch

## Views

The extension adds three views to the Activity Bar:

1. **Pull Requests**: Lists all active PRs with quick info
2. **PR Files**: Shows files changed in the selected PR
3. **Comments**: Displays comment threads for the selected PR

## Features Parity with Azure DevOps Web Interface

### ✅ Fully Implemented (Complete Parity)

**Core PR Operations:**
- View PR list with filtering by status
- View PR details (title, description, reviewers, metadata)
- View all changed files with change types
- View file content with syntax highlighting
- View all comment threads
- Add general and file-level comments
- Approve PRs
- Complete (merge) PRs
- Abandon PRs
- Checkout PR branch locally
- View reviewer votes and status

**Advanced Features:**
- ✅ **Side-by-Side Diff Viewer**: Compare original vs modified files side-by-side
- ✅ **Inline Line Comments**: Add comments on specific code lines with full threading
- ✅ **Work Item Integration**: Link and view Azure Boards work items
- ✅ **Build & Policy Status**: View CI/CD pipeline status and policy evaluations
- ✅ **Merge Conflict Detection**: Detect and view merge conflicts
- ✅ **PR Iteration History**: View all PR updates and iterations
- ✅ **Label Management**: Add and remove PR labels
- ✅ **Completion Options**: Configure squash merge, delete source branch, etc.
- ✅ **Comment Threading**: Reply to comments and resolve/unresolve threads
- ✅ **Required Reviewers**: Distinguish between required and optional reviewers

### ⚠️ Remaining Limitations

The following features are not yet available:

1. **File Attachments**: Cannot upload or view file attachments
2. **@Mentions in UI**: No autocomplete for @mentions (but can type them manually)
3. **PR Description Templates**: Doesn't auto-populate organization templates
4. **Linked Pull Requests**: Doesn't show related/dependent PRs
5. **Merge Conflict Resolution UI**: Can detect conflicts but not resolve them in the UI (use git CLI)

**The extension now has near-complete parity with Azure DevOps web interface** - all essential PR review and management features are available in VSCode!

## Development

### Building from Source

```bash
# Clone the repository
git clone <repository-url>
cd vscode-devops-plugin

# Install dependencies
npm install

# Compile
npm run compile

# Watch for changes
npm run watch
```

### Testing

```bash
# Run tests
npm test
```

### Packaging

```bash
# Install vsce
npm install -g @vscode/vsce

# Package extension
vsce package
```

## Troubleshooting

### Authentication Issues (401 Errors)

If you're experiencing authentication failures, see the **[PAT Troubleshooting Guide](./TROUBLESHOOTING_PAT.md)** for detailed solutions.

**Quick fixes:**
- Ensure your PAT has "Code (Read & Write)" permissions
- Check that your PAT hasn't expired
- Verify organization URL format: `https://dev.azure.com/yourorg`
- Make sure token was copied correctly without extra spaces
- Try signing out and re-authenticating

For detailed troubleshooting steps, **see [TROUBLESHOOTING_PAT.md](./TROUBLESHOOTING_PAT.md)**.

### OAuth Alternative

If PAT authentication continues to fail, try OAuth:
1. Run `Azure DevOps: Authenticate`
2. Choose "GitHub Account (OAuth)"
3. Follow the browser authentication flow

See the **[Authentication Guide](./AUTHENTICATION_GUIDE.md)** for more details on both methods.

**PRs Not Loading:**
- Check your internet connection
- Verify organization, project, and repository settings
- Ensure you have access to the repository in Azure DevOps

**Files Not Displaying:**
- Some file types may not be supported for preview
- Large files may take longer to load
- Binary files cannot be displayed

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

ISC

## Support

For issues and feature requests, please use the GitHub Issues page.

---

**Enjoy!** 🚀
