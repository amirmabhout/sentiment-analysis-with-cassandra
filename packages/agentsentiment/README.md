# Agent Sentiment

AI agent specialized in sentiment tracking for ai16z & elizaOS brands across social media platforms.

## Features

- Real-time sentiment analysis for ai16z & elizaOS brand mentions
- Statistical spike detection using moving averages and z-scores
- Entity extraction and narrative clustering
- Influence weighting based on author authority and engagement velocity
- Comprehensive dashboards showing sentiment trends and narrative analysis
- Automated alerts for sentiment threshold breaches
- Daily/weekly reporting with comparative analysis

## Getting Started

```bash
# Install dependencies
bun install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys and MCP server URL:
# - MCP_SERVER_URL=https://sequencer-v2.heurist.xyz/tool[YOUR_SERVER_ID]/sse
# - OPENAI_API_KEY=your_openai_key (or ANTHROPIC_API_KEY, GOOGLE_GENAI_API_KEY)
# - DISCORD_API_TOKEN=your_discord_token (optional, for reporting)

# Start the sentiment tracking agent
elizaos start

# For development with hot-reloading
elizaos dev
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
