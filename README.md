# Eliza

A framework for multi-agent development and deployment

## 🤖 Agent Cassandra - Advanced Sentiment Analysis

<div align="center">
<img src="cassandra.png" alt="Agent Cassandra" width="300"/>
</div>

**Agent Cassandra** is a specialized AI agent that monitors and analyzes sentiment around given keywords across social media platforms. This repository includes two custom components:

- **`packages/agentcassandra/`** - The Cassandra agent implementation with specialized personality for sentiment analysis
- **`packages/plugin-sentiment-analyzer/`** - Comprehensive sentiment analysis plugin providing real-time monitoring capabilities

## 🚨 Before You Begin

**READ THIS FIRST**: This software can be configured to use third-party Twitter data services that may violate Twitter's Terms of Service. Users are responsible for ensuring compliance with all applicable terms and policies. Consider using official Twitter API for production use.

### Prerequisites & Legal Considerations

- Ensure you have proper API access and authorization
- Review Twitter's Developer Agreement if using Twitter data
- Understand the legal implications of your intended use case
- This software is intended for educational, research, and personal use

### 🚀 Quick Start with Cassandra

1. **Install dependencies:**

   ```bash
   bun install
   ```

2. **Build the project:**

   ```bash
   bun run build
   ```

3. **Configure and run Cassandra:**
   ```bash
   cd packages/agentcassandra
   cp .env.example .env
   # Edit .env with your API keys (see configuration section below)
   bun start
   ```

### 🎯 Key Capabilities

Cassandra leverages the sentiment analyzer plugin to provide:

- **🔍 Real-time Social Media Monitoring** - Configurable data source integration (supports both official and third-party APIs)
- **🧠 Advanced LLM Sentiment Analysis** - Uses OpenAI/Anthropic/Google models for accurate sentiment scoring
- **📊 Entity & Topic Extraction** - Identifies key people, organizations, and themes in conversations
- **📈 Trend Analysis & Aggregation** - Statistical analysis of sentiment changes over time
- **⚡ Dynamic Scheduling** - Adjusts monitoring frequency based on social media traffic patterns
- **🚨 Intelligent Alert System** - Real-time alerts for high-importance negative sentiment
- **💬 Discord Integration** - Automated reporting and alerts in Discord channels (any other client such as telegram, etc is possible with Eliza's plug and play clients)
- **💾 Historical Data Persistence** - Maintains sentiment history for comprehensive trend analysis

## 🔧 Configuration

**Before proceeding, ensure you have proper authorization to access social media APIs.**

### API Keys Required

#### Official Twitter/X API (Recommended for Production)

For compliance with Twitter/X Terms of Service, consider using their official API:

```bash
# Official Twitter API v2
TWITTER_BEARER_TOKEN=your_official_twitter_token
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET_KEY=your_twitter_api_secret_key
```

#### Alternative: Third-Party Services (Use at Your Own Risk)

```bash
# RapidAPI (Third-party service - may violate Twitter ToS)
RAPIDAPI_API_KEY=your_rapidapi_key
RAPIDAPI_X_HOST=your_rapidapi_host
```

**⚠️ Warning**: Using third-party Twitter data services may violate Twitter's Terms of Service and could result in your Twitter account being suspended.

#### LLM Provider (Required)

```bash
# Choose one
OPENAI_API_KEY=your_openai_key
# OR ANTHROPIC_API_KEY=your_anthropic_key
# OR GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
```

#### Optional Integration

```bash
# Discord Bot (optional, for reporting)
DISCORD_API_TOKEN=your_discord_bot_token
DISCORD_REPORT_CHANNEL=your_channel_id

# Customize monitoring
SENTIMENT_WATCH_TERMS=ai16z,elizaos,eliza
```

### 📋 Example Interactions

Ask Cassandra for insights:

- "What's the current sentiment around ai16z?"
- "Show me the weekly sentiment analysis"
- "Are there any sentiment spikes I should know about?"

## ⚠️ Legal Disclaimer and Terms of Service Compliance

**IMPORTANT: Please read before using this software.**

### Third-Party API Usage

This software is designed to work with third-party Twitter/X data providers (such as RapidAPI services). **The use of such services may violate Twitter/X's Terms of Service.**

### User Responsibility

- **You are solely responsible** for ensuring compliance with all applicable Terms of Service, including Twitter/X's Developer Agreement and Terms of Service
- **You are responsible** for obtaining proper API access and following rate limits
- **This software is provided for educational and research purposes**
- The maintainers of this repository do not endorse or encourage violation of any platform's Terms of Service

### Legal Compliance

- Users must comply with all applicable laws and regulations in their jurisdiction
- Users must respect platform rate limits, user privacy, and content policies
- Users should consider using official Twitter/X API services for production use

### No Warranty

This software is provided "AS IS" without warranty of any kind. The maintainers are not responsible for any consequences resulting from the use of this software.

By using this software, you acknowledge that you understand and accept these terms.

## 📋 Compliance and Best Practices

### Recommended Usage

- **Research and Educational Purposes**: This tool is ideal for academic research, personal learning, and educational projects
- **Small-Scale Monitoring**: Suitable for monitoring specific keywords for personal or small business use
- **Prototype Development**: Perfect for building proof-of-concepts before moving to official APIs

### Production Usage Recommendations

For production applications, we strongly recommend:

1. Using Twitter's official API v2
2. Applying for appropriate access levels through Twitter Developer Portal
3. Implementing proper rate limiting and data handling
4. Following Twitter's Developer Agreement and Policy

### Data Handling

- Respect user privacy and data protection regulations (GDPR, CCPA, etc.)
- Implement appropriate data retention policies
- Secure API keys and sensitive data
- Do not store personal data unnecessarily

---

## ✨ Features

- 🛠️ Full-featured Discord, Telegram, and Farcaster connectors (and many more!)
- 🔗 Support for every model (Llama, Grok, OpenAI, Anthropic, Gemini, etc.)
- 🎨 Modern and professional UI with a redesigned dashboard for managing agents and groups.
- 💬 Robust real-time communication with enhanced channel and message handling.
- 👥 Multi-agent and group support with intuitive management.
- 📚 Easily ingest and interact with your documents.
- 💾 Retrievable memory and document store.
- 🚀 Highly extensible - create your own actions and clients.
- 📦 Just works!

## 🎯 Use Cases

- 🤖 Chatbots
- 🕵️ Autonomous Agents
- 📈 Business Process Handling
- 🎮 Video Game NPCs
- 🧠 Trading

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v23 or higher recommended)
- [bun](https://bun.sh/docs/installation)

> **Note for Windows Users:** [WSL 2](https://learn.microsoft.com/en-us/windows/wsl/install-manual) is required.

### Use the CLI (Recommended)

The ElizaOS CLI provides the fastest and most reliable way to create, configure, and run agents. It handles all the complex setup automatically.

#### 1. Install the CLI

```bash
# Install the ElizaOS CLI globally
bun install -g @elizaos/cli

# Verify installation
elizaos --version

# Get help with available commands
elizaos --help
```

#### 2. Create Your First Project

```bash
# Create a new project with interactive setup
elizaos create my-agent

# Or create with specific options (skips prompts)
elizaos create my-agent --yes --type project
```

**Recommended Options for Beginners:**

- **Database**: `pglite` (lightweight, no setup required)
- **Model Provider**: `openai` (most reliable and well-tested)
- **Project Type**: `project` (full ElizaOS application with runtime and agents)

#### 3. Configure Your Agent

```bash
cd my-agent

# Edit your local env file
elizaos env edit-local

# Or manually edit the .env file with your preferred editor
nano .env
```

**Essential Environment Variables:**

```bash
# Required: Your model API key
OPENAI_API_KEY=your_api_key_here

# Optional: Logging level (info, debug, error)
LOG_LEVEL=info

# Optional: Discord bot token (if using Discord)
DISCORD_APPLICATION_ID=your_discord_app_id
DISCORD_API_TOKEN=your_discord_bot_token
```

#### 4. Start Your Agent

```bash
# Build and start your agent
elizaos start

# Or start with debug logging for development
LOG_LEVEL=debug elizaos start
```

After starting, your agent will be available at:

- **Web Interface**: http://localhost:3000
- **API Endpoint**: http://localhost:3000/api

#### 5. Development Workflow

```bash
# Make changes to your agent code
# Then rebuild and restart
bun run build
elizaos start

# Run tests to verify your changes
elizaos test
```

#### Advanced CLI Commands

```bash
# Create specific components
elizaos create my-plugin --type plugin    # Create a new plugin
elizaos create my-agent --type agent      # Create a new agent character
elizaos create my-tee --type tee          # Create a TEE project

# Environment management
elizaos env list            # Show all environment variables
elizaos env reset           # Reset to default .env.example

# Testing options
elizaos test --name "my-test"    # Run specific tests (case sensitive)
elizaos test e2e                 # Run end-to-end tests only
elizaos test component           # Run component tests only

# Agent management
elizaos agent list                      # List all available agents
elizaos agent start --name "Agent"     # Start a specific agent by name
elizaos agent stop --name "Agent"      # Stop a running agent
elizaos agent get --name "Agent"       # Get agent details
elizaos agent set --name "Agent" --file config.json  # Update agent configuration
```

#### Debugging and Logging

ElizaOS uses comprehensive logging to help you understand what your agent is doing:

```bash
# Different log levels
LOG_LEVEL=error elizaos start    # Only errors
LOG_LEVEL=info elizaos start     # General information (default)
LOG_LEVEL=debug elizaos start    # Detailed debugging info
LOG_LEVEL=verbose elizaos start  # Everything (very detailed)

# Advanced debugging (combine with LOG_LEVEL=debug)
ELIZA_DEBUG=true elizaos start          # Enable ElizaOS debug output
NODE_ENV=development elizaos start      # Development mode with extra logging
```

**Pro Tips:**

- Use `elizaos --help` to see all available commands and global options
- Use `elizaos <command> --help` for detailed help on any specific command
- Use `LOG_LEVEL=debug` during development to see detailed execution flow
- Check the web interface at http://localhost:3000 for real-time agent status
- Use `elizaos test` frequently to catch issues early
- Keep your `.env` file secure and never commit it to version control

#### Available Commands Reference

**All CLI Commands:**

```bash
elizaos create     # Create new projects, plugins, agents, or TEE projects
elizaos start      # Start the agent server with character profiles
elizaos agent      # Manage agents (list, start, stop, get, set)
elizaos test       # Run tests (component, e2e, or all)
elizaos env        # Manage environment variables and configuration
elizaos dev        # Start in development mode with auto-rebuild
elizaos update     # Update CLI and project dependencies
# To stop agents, use Ctrl+C in the terminal where elizaos start is running
elizaos publish    # Publish plugins to registry
elizaos plugins    # Manage and discover plugins
elizaos monorepo   # Monorepo development utilities
elizaos tee        # Trusted Execution Environment commands

# Get help for any specific command
elizaos <command> --help    # e.g., elizaos create --help, elizaos agent --help
```

### Manually Start Eliza (Only recommended if you know what you are doing)

#### Prerequisites

- **Node.js** (v18+ recommended)
- **bun** (for CLI and dependencies)
- **git** (for project/plugin tests)

#### Checkout the latest release

```bash
# Clone the repository
git clone https://github.com/elizaos/eliza.git

# This project iterates fast, so we recommend checking out the latest release
git checkout $(git describe --tags --abbrev=0)
# If the above doesn't checkout the latest release, this should work:
# git checkout $(git describe --tags `git rev-list --tags --max-count=1`)
```

#### Edit the .env file

Copy .env.example to .env and fill in the appropriate values.

```
cp .env.example .env
```

Note: .env is optional. If you're planning to run multiple distinct agents, you can pass secrets through the character JSON

#### Start Eliza

Important! We now use Bun. If you are using npm, you will need to install Bun:
https://bun.sh/docs/installation

```bash
bun install
bun run build
bun start
```

### Interact via Browser

Once Eliza is running, access the modern web interface at http://localhost:3000. It has been professionally redesigned and features:

- A welcoming dashboard with a gradient hero section and clear calls-to-action for creating agents and groups.
- Visually enhanced cards for managing agents and groups, including status indicators and member counts.
- Real-time chat capabilities with your agents.
- Character configuration options.
- Plugin management.
- Comprehensive memory and conversation history.
- Responsive design for an optimal experience on various screen sizes.

## Citation

We now have a [paper](https://arxiv.org/pdf/2501.06781) you can cite for the Eliza OS:

```bibtex
@article{walters2025eliza,
  title={Eliza: A Web3 friendly AI Agent Operating System},
  author={Walters, Shaw and Gao, Sam and Nerd, Shakker and Da, Feng and Williams, Warren and Meng, Ting-Chien and Han, Hunter and He, Frank and Zhang, Allen and Wu, Ming and others},
  journal={arXiv preprint arXiv:2501.06781},
  year={2025}
}
```

## Contributors

<a href="https://github.com/elizaos/eliza/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=elizaos/eliza" alt="Eliza project contributors" />
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=elizaos/eliza&type=Date)](https://star-history.com/#elizaos/eliza&Date)

## Git Hooks

This project uses git hooks to ensure code quality:

- **pre-commit**: Automatically formats staged files using Prettier before committing

To run the pre-commit hook manually:

```bash
bun run pre-commit
```

## 📂 Repository Structure

Eliza is organized as a monorepo using Bun, Lerna, and Turbo for efficient package management and build orchestration. Here's a detailed overview of the project structure:

- **`/` (Root)**:

  - `.github/`: GitHub Actions workflows for CI/CD pipelines and issue templates
  - `.husky/`: Git hooks configuration, including pre-commit formatting
  - `.devcontainer/`: Development container configurations for consistent environments
  - `packages/`: Core packages and modules (detailed below)
  - `scripts/`: Build, development, and utility scripts
  - `data/`: Application and user data storage
  - `AGENTS.md`: Comprehensive agent documentation and specifications
  - `CHANGELOG.md`: Detailed version history and changes
  - `Dockerfile`, `docker-compose.yaml`: Container configurations for deployment
  - `lerna.json`, `package.json`, `turbo.json`: Monorepo configuration and workspace definitions

- **`/packages/`**: Core components of the Eliza framework:
  - `core/`: The foundational package (@elizaos/core) implementing:
    - PDF processing capabilities
    - Logging and error handling infrastructure
  - `app/`: Tauri-based cross-platform application (@elizaos/app)
    - React-based UI implementation
    - Tauri plugins for system integration
    - Desktop and mobile builds support
  - `autodoc/`: Documentation automation tool (@elizaos/autodoc)
    - LangChain-powered documentation generation
    - TypeScript parsing and analysis
    - GitHub integration via Octokit
  - `cli/`: Command-line interface for Eliza management
  - `client/`: Client libraries for web interfaces
  - `create-eliza/`: Project scaffolding tool
  - `docs/`: Official documentation source files
  - `plugin-bootstrap/`: **Essential communication core** (@elizaos/plugin-bootstrap)
    - **Required for basic agent functionality** - handles all message processing
    - Provides critical event handlers (MESSAGE_RECEIVED, VOICE_MESSAGE_RECEIVED, etc.)
    - Implements fundamental agent actions (reply, follow/unfollow, mute/unmute)
    - Contains core evaluators and providers for agent cognition
    - Manages message processing pipeline and response generation
    - **Mandatory unless building custom event handling system**
  - `plugin-sql/`: Database integration (@elizaos/plugin-sql)
    - PostgreSQL integration with PGLite support
    - Drizzle ORM for type-safe queries
    - Migration management tools
    - Integration testing support
  - `plugin-starter/`: Template for creating new plugins
  - `project-starter/`, `project-tee-starter/`: Project templates

This architecture enables modular development, clear separation of concerns, and scalable feature implementation across the Eliza ecosystem.
