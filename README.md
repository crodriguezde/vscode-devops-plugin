# Azure DevOps PR Viewer

A powerful Visual Studio Code extension for managing Azure DevOps Pull Requests directly from your editor.

## Features

### 🎯 Core Functionality

- **Pull Request Management**: View, review, approve, and complete PRs without leaving VSCode
- **Multiple Grouping Modes**: Organize PRs by people, work items, or custom manual groups
- **Work Item Integration**: Automatic linking and hierarchical grouping by work items
- **Comment Chat Interface**: Unified chat-style interface for PR comments (opens on the right side)
- **Enhanced Diff Viewer**: Compare changes with flexible commit selection
- **Authentication**: Seamless Azure CLI integration for secure authentication
- **AI-Powered Comments**: Optional AI enhancement for comment drafting (requires GitHub Copilot)

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
- Use the layers icon (📊) to select hierarchy level

#### Manual Groups (📁)
Custom grouping for flexible PR organization:
- Create custom groups for any purpose (e.g., "Ready for Review", "Blocked", "Hot Fixes")
- Drag and drop PRs between groups
- Add/remove PRs from groups via context menu
- Rename or delete groups as needed
- Groups persist across sessions

### 💬 Comment Chat Interface

A unified chat-style interface for all PR comments:

#### Features
- **Opens on Right Side**: Comment chat panel appears beside your code editor
- **Thread View**: See entire comment conversations in chronological order
- **Quick Reply**: Type and send replies directly in the chat
- **AI Enhancement** (Optional): Use GitHub Copilot to:
  - Rephrase comments
  - Expand ideas
  - Simplify language
  - Fix grammar
- **No More Popups**: All comment creation and replies happen in the chat panel

#### Usage
1. **Add New Comment**: 
   - Right-click on a file → "Add Comment" 
   - Or right-click in the diff editor → "Pull Request: Add Comment"
   - Chat panel opens on the right with context (file name, line number, selected code)
   
2. **Reply to Existing Comment**: 
   - Click "Reply to Comment" from Comments tree view
   - Chat panel shows full conversation thread
   - Type your reply and press Send

3. **Comment at Specific Line**:
   - Select code in diff editor
   - Right-click → "Pull Request: Add Comment"
   - Chat shows selected code snippet
   - Type comment and press Send to create at that line

### 🔧 Configuration

Access settings via the gear icon (⚙️) in the Pull Requests view or through VSCode settings:

#### Connection Settings
- **Organization URL**: Your Azure DevOps organization (e.g., `https://dev.azure.com/myorg`)
- **Project**: Project name
- **Repository**: Repository name (auto-detects from git if empty)

#### Display Settings
- **Auto-refresh**: Automatically refresh PRs on startup
- **Refresh Interval**: How often to refresh (default: 300 seconds)
- **Work Item Grouping Level**: Hierarchy level for work item grouping (0-4)
  - Level 0: Group by directly linked work item
  - Level 1: Group by parent (1 level up) - Default
  - Level 2: Group by grandparent (2 levels up)
  - Level 3: Group by 3 levels up
  - Level 4: Group by 4 levels up

#### Debug Settings
- **Debug Work Item Hierarchy**: Enable verbose logging for work item operations
- **Debug Work Item Display**: Enable detailed logging for work item visibility issues

#### Diff Viewer Settings
- **Default Commit Selection**: Latest, Base, or Custom
- **Show Commit Dropdowns**: Display commit selectors in diff viewer

#### Comment Settings
- **Inline Display**: Show comments directly in editor
- **Show Resolved**: Display resolved comment threads

#### AI Settings
- **Enable AI Comment Enhancement**: Use GitHub Copilot for comment suggestions (requires GitHub Copilot extension)

## Installation

1. Install the extension from the VSCode Marketplace
2. Install and login to Azure CLI:
   ```bash
   az login
   ```
3. Configure your Azure DevOps organization, project, and repository in settings
4. (Optional) Install GitHub Copilot extension for AI-powered comment enhancement

## Usage

### Getting Started

1. **Open the Extension**: Click the Azure DevOps icon in the Activity Bar
2. **Configure Settings**: Click the gear icon (⚙️) to set up your organization details
3. **Refresh**: Click the refresh icon (🔄) to load pull requests

### Managing Pull Requests

#### Viewing PRs
- Click any PR to view its files and details
- Use the context menu (right-click) for quick actions
- Toggle between view modes using the header buttons (👤, 🏢, 📁)

#### Manual Grouping Workflow
1. **Switch to Manual Mode**: Click the folder icon (📁) in the toolbar
2. **Create Groups**: Click "Create Group" and name it
3. **Add PRs**: Right-click a PR → "Add to Group" → Select group
4. **Organize**: Drag and drop PRs between groups
5. **Manage Groups**: Right-click a group to rename or delete

#### Reviewing PRs with Comment Chat

##### Adding New Comments
1. Open a PR file in the diff viewer
2. Select the code you want to comment on (optional)
3. Right-click → "Pull Request: Add Comment"
4. Comment chat opens on the right showing:
   - File name and line number
   - Selected code snippet (if any)
5. Type your comment in the input box
6. (Optional) Click "✨ AI" to enhance your comment
7. Press "Send" or hit Enter to create the comment

##### Replying to Comments
1. In the Comments tree view, find the comment thread
2. Right-click → "Reply to Comment"
3. Comment chat opens showing the full conversation
4. Type your reply and press Send
5. Your reply appears in the thread immediately

##### Using AI Enhancement
If GitHub Copilot is installed:
1. Type your comment draft
2. Click the "✨ AI" button
3. Choose an action:
   - **Rephrase**: Reword for clarity
   - **Expand**: Add more detail
   - **Simplify**: Make it more concise
   - **Fix Grammar**: Correct grammar and spelling
4. Review the enhanced version
5. Edit if needed and send

#### PR Actions
- **Approve**: Approve a pull request
- **Complete**: Merge and complete a pull request
- **Abandon**: Abandon a pull request
- **Checkout**: Switch to the PR's branch locally
- **Resolve Comments**: Mark comment threads as resolved

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

**Debugging Work Items**:
- Right-click a PR → "Debug Work Items"
- View detailed hierarchy information
- Check console logs for troubleshooting

### Review Tracking

Mark PRs with your review status:
- **⏳ Pending My Review**: PRs waiting for your review
- **✓ Reviewed by Me**: PRs you've already reviewed

Toggle these states from the PR context menu.

## Keyboard Shortcuts

- `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) → Search for "Azure DevOps" commands
- `Enter` in comment chat → Send message
- `Shift+Enter` in comment chat → New line
- Quick access to all PR operations through the command palette

## Commands

### Core Commands
- `Azure DevOps: Login with Azure CLI` - Authenticate with Azure CLI
- `Azure DevOps: Refresh Pull Requests` - Manually refresh PR list
- `Azure DevOps: Open Settings` - Open extension settings

### Grouping Commands
- `Group by People` - Switch to people-based grouping
- `Group by Work Items` - Switch to work item-based grouping
- `Manual Groups` - Switch to manual grouping mode
- `Create Group` - Create a new manual group (when in manual mode)
- `Delete All Groups` - Remove all manual groups
- `Select Work Item Level` - Choose work item hierarchy level

### Comment Commands
- `Pull Request: Add Comment` - Add comment at current line
- `Azure DevOps: Reply to Comment` - Reply to comment thread
- `Azure DevOps: Resolve Comment` - Mark thread as resolved
- `Azure DevOps: Toggle Inline Comments` - Show/hide inline comments
- `Azure DevOps: Refresh Inline Comments` - Reload comment display

### PR Commands
- `Azure DevOps: Open Pull Request` - Open PR files and details
- `Azure DevOps: Approve Pull Request` - Approve the PR
- `Azure DevOps: Complete Pull Request` - Merge and complete
- `Azure DevOps: Abandon Pull Request` - Abandon the PR
- `Azure DevOps: Checkout Branch` - Switch to PR branch

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
2. Enable "Debug Work Item Hierarchy" in settings
3. Right-click a PR → "Debug Work Items" to see detailed information
4. Check Output panel (View → Output → select "Azure DevOps PR Viewer")
5. Verify work items have proper parent relationships

### Comment Chat Not Opening

1. Check if the panel is hidden - look for tabs on the right side
2. Try closing and reopening the comment action
3. Check console for errors (Help → Toggle Developer Tools)
4. Verify PR has proper permissions for commenting

### AI Enhancement Not Working

1. Ensure GitHub Copilot extension is installed
2. Verify Copilot is active and authenticated
3. Check "Enable AI Comment Enhancement" in settings
4. Look for error messages in the chat interface

### PRs Not Loading

1. Verify settings are correctly configured
2. Check repository name matches exactly (case-sensitive)
3. Ensure Azure CLI authentication is valid
4. Check the Output panel (View → Output → Azure DevOps PR Viewer)
5. Try manual refresh with the 🔄 button

## Technical Details

### Architecture

- **Frontend**: VSCode TreeView providers with drag-and-drop support
- **Backend**: Azure DevOps REST API via `azure-devops-node-api`
- **Authentication**: Azure CLI token integration
- **State Management**: Workspace state for PR tracking and manual groups
- **Comment UI**: WebView panel with chat-style interface
- **AI Integration**: GitHub Copilot API for comment enhancement

### Performance

- **Fast Initial Load**: People view loads immediately
- **Background Processing**: Work items fetch in background with progress
- **Reactive Updates**: Settings changes trigger automatic refresh
- **Efficient Caching**: Work item hierarchy caching to minimize API calls
- **Persistent State**: Manual groups and review states saved in workspace

### Comment Chat Implementation

- **WebView Panel**: Chat interface built with HTML/CSS/JavaScript
- **Real-time Updates**: Live message addition without panel refresh
- **Context Preservation**: File path, line numbers, and selected code preserved
- **AI Integration**: Optional GitHub Copilot enhancement
- **Side Panel Layout**: Opens with `ViewColumn.Beside` for optimal workflow

## Requirements

- Visual Studio Code 1.75.0 or higher
- Azure CLI installed and configured
- Access to an Azure DevOps organization
- Git repository connected to Azure DevOps
- (Optional) GitHub Copilot extension for AI features

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
├── providers/      # VSCode tree data providers and webview providers
├── services/       # Business logic, API calls, and AI services
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
- Enable debug settings for verbose logging

## Changelog

### Version 0.1.0 (Current)

- Initial release
- Three view modes (People/Work Items/Manual Groups)
- Work item hierarchy support (0-4 levels)
- Drag-and-drop manual grouping
- Comment chat interface (opens on right side)
- AI-powered comment enhancement
- Enhanced diff viewer with commit selection
- Azure CLI authentication
- PR review tracking (Pending/Reviewed)
- Comprehensive settings UI
- Debug tools for work item troubleshooting

---

**Made with ❤️ for Azure DevOps users**
