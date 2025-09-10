# Agent Sentiment

AI agent specialized in sentiment tracking for ai16z & elizaOS brands across social media platforms.

## ⚠️ Legal Notice

**IMPORTANT**: This software may use third-party Twitter data services that could violate Twitter's Terms of Service. Users are solely responsible for ensuring compliance with all applicable platform policies. Consider using official Twitter API for production use. This software is provided for educational and research purposes.

## Features

- Real-time sentiment analysis for ai16z & elizaOS brand mentions
- Statistical spike detection using moving averages and z-scores
- Entity extraction and narrative clustering
- Influence weighting based on author authority and engagement velocity
- Comprehensive dashboards showing sentiment trends and narrative analysis
- Automated alerts for sentiment threshold breaches
- Daily/weekly reporting with comparative analysis

## Getting Started

**Before proceeding, ensure you have proper authorization to access social media APIs.**

```bash
# Install dependencies
bun install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys - see Configuration section for details
# ⚠️ WARNING: Using third-party Twitter services may violate Twitter ToS

# Start the sentiment tracking agent
elizaos start

# For development with hot-reloading
elizaos dev
```

## Configuration

### API Keys Required

#### Official Twitter/X API (Recommended)
For compliance with Twitter/X Terms of Service:
```bash
TWITTER_BEARER_TOKEN=your_official_twitter_token
TWITTER_API_KEY=your_twitter_api_key
```

#### Alternative: Third-Party Services (Use at Your Own Risk)
```bash
# RapidAPI (Third-party service - may violate Twitter ToS)
RAPIDAPI_API_KEY=your_rapidapi_key
RAPIDAPI_X_HOST=your_rapidapi_host
```

#### LLM Provider (Required)
```bash
# Choose one
OPENAI_API_KEY=your_openai_key
# OR ANTHROPIC_API_KEY=your_anthropic_key
# OR GOOGLE_GENAI_API_KEY=your_google_key
```

#### Optional Integration
```bash
# Discord Bot (optional, for reporting)
DISCORD_API_TOKEN=your_discord_token
```

## Development

```bash
# Start development with hot-reloading (recommended)
elizaos dev

# OR start without hot-reloading
elizaos start
# Note: When using 'start', you need to rebuild after changes:
# bun run build

# Test the project
elizaos test
```

## Testing

ElizaOS provides a comprehensive testing structure for projects:

### Test Structure

- **Component Tests** (`__tests__/` directory):

  - **Unit Tests**: Test individual functions and components in isolation
  - **Integration Tests**: Test how components work together
  - Run with: `elizaos test component`

- **End-to-End Tests** (`e2e/` directory):

  - Test the project within a full ElizaOS runtime
  - Run with: `elizaos test e2e`

- **Running All Tests**:
  - `elizaos test` runs both component and e2e tests

### Writing Tests

Component tests use Vitest:

```typescript
// Unit test example (__tests__/config.test.ts)
describe('Configuration', () => {
  it('should load configuration correctly', () => {
    expect(config.debug).toBeDefined();
  });
});

// Integration test example (__tests__/integration.test.ts)
describe('Integration: Plugin with Character', () => {
  it('should initialize character with plugins', async () => {
    // Test interactions between components
  });
});
```

E2E tests use ElizaOS test interface:

```typescript
// E2E test example (e2e/project.test.ts)
export class ProjectTestSuite implements TestSuite {
  name = 'project_test_suite';
  tests = [
    {
      name: 'project_initialization',
      fn: async (runtime) => {
        // Test project in a real runtime
      },
    },
  ];
}

export default new ProjectTestSuite();
```

The test utilities in `__tests__/utils/` provide helper functions to simplify writing tests.

## Configuration

Customize your project by modifying:

- `src/index.ts` - Main entry point
- `src/character.ts` - Character definition
