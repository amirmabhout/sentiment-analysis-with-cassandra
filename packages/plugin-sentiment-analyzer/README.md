# ElizaOS Sentiment Analyzer Plugin

A comprehensive sentiment analysis plugin for ElizaOS that tracks social media sentiment around ai16z and elizaOS. This plugin provides real-time monitoring, trend analysis, and automated reporting capabilities.

## Features

- **Real-time Twitter Monitoring**: Automatically fetches tweets mentioning configured watch terms
- **Advanced Sentiment Analysis**: Uses LLM models to score sentiment with confidence levels
- **Entity & Topic Extraction**: Identifies key people, organizations, and themes in conversations
- **Trend Analysis**: Tracks sentiment changes over time with statistical analysis
- **Discord Integration**: Automated reporting and alerts in Discord channels
- **Recurring Processing**: Configurable intervals for continuous monitoring
- **Historical Data**: Maintains sentiment history for trend analysis

## Installation

This plugin is designed to work within the ElizaOS ecosystem. It depends on:

- `@elizaos/core` - Core ElizaOS functionality
- `@elizaos/plugin-twitter` - Twitter integration for data fetching
- `@elizaos/plugin-discord` - Discord integration for reporting

## Configuration

Configure the plugin using environment variables:

### Required Configuration

```bash
# LLM API Key (choose one)
OPENAI_API_KEY=your_openai_key
# OR
ANTHROPIC_API_KEY=your_anthropic_key
# OR  
GOOGLE_GENAI_API_KEY=your_google_key

# Twitter API credentials (for data fetching)
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
TWITTER_EMAIL=your_twitter_email

# Discord Bot Token (for reporting)
DISCORD_API_TOKEN=your_discord_bot_token
```

### Optional Configuration

```bash
# Watch terms to monitor (comma-separated)
SENTIMENT_WATCH_TERMS=ai16z,elizaos,eliza

# Processing interval in milliseconds (default: 5 minutes)
SENTIMENT_PROCESSING_INTERVAL=300000

# Maximum tweets to fetch per cycle (default: 50)
TWITTER_MAX_TWEETS_PER_CYCLE=50

# Maximum sentiment history to keep in memory (default: 10000)
SENTIMENT_MAX_HISTORY=10000

# Discord channel ID for reports (optional)
DISCORD_REPORT_CHANNEL=your_channel_id
```

## Usage

### In Character Configuration

Add the plugin to your ElizaOS character:

```typescript
import { type Character } from '@elizaos/core';

export const character: Character = {
  name: 'SentimentAgent',
  plugins: [
    '@elizaos/plugin-bootstrap',
    '@elizaos/plugin-sql', 
    '@elizaos/plugin-twitter',
    '@elizaos/plugin-discord',
    '@elizaos/plugin-sentiment-analyzer' // Add this line
  ],
  // ... rest of character config
};
```

### Interacting with the Agent

The plugin enables several interaction patterns:

**Request sentiment reports:**
- "What's the current sentiment around ai16z?"
- "Show me the weekly sentiment analysis"
- "Generate a sentiment report for the last 24 hours"

**Check for alerts:**
- "Are there any sentiment spikes?"
- "Any alerts I should know about?"

The agent will automatically:
- Process new social media posts every 5 minutes (configurable)
- Generate detailed reports every 6 hours
- Perform trend analysis every 24 hours
- Send Discord alerts when significant changes are detected

## Architecture

### Services

1. **SentimentAnalysisService**: Core sentiment scoring using LLM models
2. **TwitterStreamService**: Fetches and filters Twitter data
3. **SentimentAggregatorService**: Aggregates data and generates insights

### Tasks

1. **sentimentProcessingTask**: Main recurring task (every 5 minutes)
2. **sentimentReportingTask**: Detailed reports (every 6 hours)
3. **sentimentTrendAnalysisTask**: Trend analysis (every 24 hours)

### Actions

1. **sentimentReportAction**: Generate and post sentiment reports

### Providers

1. **sentimentDataProvider**: Current sentiment context for conversations
2. **sentimentTrendsProvider**: Historical trend information

## Data Types

The plugin works with several key data structures:

- **SentimentScore**: Numerical sentiment with confidence levels
- **ProcessedSentiment**: Analyzed social media post with entities/topics
- **SentimentAggregation**: Aggregated metrics over time windows
- **SentimentReport**: Comprehensive reports with alerts and narratives

## Development

### Building

```bash
bun run build
```

### Testing

```bash
bun test
```

### Linting

```bash
bun run lint
```

## Example Output

The plugin generates structured sentiment reports like:

```
📊 Sentiment Analysis Report - Last 24 Hours

Overall Metrics:
• Total posts analyzed: 247
• Average sentiment: +0.68 (Positive)
• Volume change: +12% vs previous period

Watch Term Analysis:
• ai16z: 156 posts, sentiment +0.72 🟢
• elizaos: 91 posts, sentiment +0.63 🔵

Key Narratives:
1. Partnership announcements (89 posts) 🟢
   Key phrases: partnership, collaboration, ecosystem

2. Technical development (67 posts) 🔵  
   Key phrases: updates, features, development

Top Mentioned Entities:
• ai16z (124 mentions) 🟢
• elizaOS (98 mentions) 🔵

Summary: Positive sentiment across 247 posts. Primary discussion themes include partnership announcements and technical development.
```

## Contributing

This plugin is part of the ElizaOS ecosystem. Follow the project's contribution guidelines when submitting improvements or bug fixes.

## License

Same license as the main ElizaOS project.