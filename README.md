# Azure DevOps PR Viewer

A powerful Visual Studio Code extension for managing Azure DevOps Pull Requests directly from your editor.

## Features

### 🎯 Core Functionality

- **Pull Request Management**: View, review, approve, and complete PRs without leaving VSCode
- **Dual View Modes**: Switch between grouping PRs by people or work items
- **Work Item Integration**: Automatic linking and hierarchical grouping by work items
- **Inline Comments**: View and respond to PR comments directly in your code
- **Enhanced Diff Viewer**: Compare changes with flexible commit selection
- **Authentication**: Seamless Azure CLI integration for secure authentication

### 📊 View Modes

#### Group by People (👤)
Fast, default view that organizes PRs by author:
- **People** → **Pull Requests**
- Instant loading on refresh
- Perfect for team-based workflows

#### Group by Work Items (🏢)
Hierarchical view that organizes by work item relationships:
- **Work Items** → **People** → **Pull Requests**
- Configurable hierarchy levels (0-4)
- Background loading with progress notifications

### 🔧 Configuration

Access settings via the gear icon (⚙️) in the Pull Requests view or through VSCode settings:

#### Connection Settings
- **Organization URL**: Your Azure DevOps organization (e.g., `https://dev.azure.com/myorg`)
- **Project**: Project name
- **Repository**: Repository name (auto-detects from git if empty)

#### Display Settings
- **Auto-refresh**: Automatically refresh PRs on startup
- **Refresh Interval**: How often to refresh (minimum 60 seconds)
- **Max PRs to Show**: Maximum number of PRs to display (1-200)
- **Work Item Grouping Level**: Hierarchy level for work item grouping (0-4)
  - Level 0: Group by directly linked work item
  - Level 1: Group by parent (1 level up) - Default
  - Level 2: Group by grandparent (2 levels up)
  - Level 3: Group by 3 levels up
  - Level 4: Group by 4 levels up

#### Diff Viewer Settings
- **Default Commit Selection**: Latest, Base, or Custom
- **Show Commit Dropdowns**: Display commit selectors in diff viewer

#### Comment Settings
- **Inline Display**: Show comments directly in editor
- **Show Resolved**: Display resolved comment threads
- **Auto-refresh**: Automatically refresh comments on changes

## Installation

1. Install the extension from the VSCode Marketplace
2. Install and login to Azure CLI:
   ```bash
   az login
   ```
3. Configure your Azure DevOps organization, project, and repository in settings

## Usage

### Getting Started

1. **Open the Extension**: Click the Azure DevOps icon in the Activity Bar
2. **Configure Settings**: Click the gear icon (⚙️) to set up your organization details
3. **Refresh**: Click the refresh icon (🔄) to load pull requests

### Managing Pull Requests

#### Viewing PRs
- Click any PR to view its files and details
- Use the context menu (right-click) for quick actions
- Toggle between view modes using the header buttons

#### Reviewing PRs
- **View Files**: Click on any file to see changes
- **Add Comments**: Right-click in the editor → "Pull Request: Add Comment"
- **Reply to Comments**: Use the Comments view to respond to threads
- **Resolve Comments**: Mark comment threads as resolved

#### PR Actions
- **Approve**: Approve a pull request
- **Complete**: Merge and complete a pull request
- **Abandon**: Abandon a pull request
- **Checkout**: Switch to the PR's branch locally

### Work Item Integration

When a PR is linked to work items:
1. Extension fetches the linked work item
2. Traverses up the work item hierarchy based on configured level
3. Groups the PR under the appropriate parent work item
4. Shows hierarchy: Work Item → Person → PR

**Example with Level 2**:
- PR linked to Task #123
- Task #123 → Feature #456 → Epic #789
- PR grouped under Epic #789

### Review Tracking

Mark PRs with your review status:
- **⏳ Pending My Review**: PRs waiting for your review
- **✓ Reviewed by Me**: PRs you've already reviewed

Toggle these states from the PR context menu.

## Keyboard Shortcuts

- `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) → Search for "Azure DevOps" commands
- Quick access to all PR operations through the command palette

## Commands

- `Azure DevOps: Login with Azure CLI` - Authenticate with Azure CLI
- `Azure DevOps: Refresh Pull Requests` - Manually refresh PR list
- `Azure DevOps: Open Settings` - Open extension settings
- `Azure DevOps: Toggle Inline Comments` - Show/hide inline comments
- `Pull Request: Add Comment` - Add comment at current line

## Troubleshooting

### Authentication Issues

If you encounter authentication problems:

1. Verify Azure CLI is installed and logged in:
   ```bash
   az --version
   az account show
   ```

2. Ensure your account has access to Azure DevOps:
   ```bash
   az devops configure --defaults organization=https://dev.azure.com/yourorg
   ```

3. Check required permissions:
   - Code (Read & Write)
   - Work Items (Read)
   - Pull Request Threads (Read & Write)

### Work Item Hierarchy Not Showing

1. Check that PRs are linked to work items in Azure DevOps
2. Open Developer Tools (Help → Toggle Developer Tools)
3. Look for `[WorkItemAtLevel]` logs in the console
4. Verify the work items have proper parent relationships

### PRs Not Loading

1. Verify settings are correctly configured
2. Check repository name matches exactly (case-sensitive)
3. Ensure Azure CLI authentication is valid
4. Check the Output panel (View → Output → Azure DevOps PR Viewer)

## Technical Details

### Architecture

- **Frontend**: VSCode TreeView providers for different views
- **Backend**: Azure DevOps REST API via `azure-devops-node-api`
- **Authentication**: Azure CLI token integration
- **State Management**: Workspace state for PR tracking

### Performance

- **Fast Initial Load**: People view loads immediately
- **Background Processing**: Work items fetch in background
- **Reactive Updates**: Settings changes trigger automatic refresh
- **Efficient Caching**: Minimizes API calls

## Requirements

- Visual Studio Code 1.75.0 or higher
- Azure CLI installed and configured
- Access to an Azure DevOps organization
- Git repository connected to Azure DevOps

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Package extension
npm run package
```

### Project Structure

```
src/
├── auth/           # Authentication providers
├── providers/      # VSCode tree data providers
├── services/       # Business logic and API calls
└── types/          # TypeScript type definitions
```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - See LICENSE file for details

## Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check the Troubleshooting section above
- Review VSCode Output panel for detailed logs

## Changelog

### Version 0.1.0 (Current)

- Initial release
- Dual view modes (People/Work Items)
- Work item hierarchy support (0-4 levels)
- Inline comment integration
- Enhanced diff viewer with commit selection
- Azure CLI authentication
- PR review tracking
- Comprehensive settings UI

---

**Made with ❤️ for Azure DevOps users**
