import {
  type Provider,
  type ProviderResult,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';

/**
 * Provider that supplies current sentiment data and context
 * Used to inform the agent about recent sentiment trends
 */
export const sentimentDataProvider: Provider = {
  name: 'SENTIMENT_DATA',
  description: 'Provides current sentiment analysis data and trends for ai16z and elizaOS',

  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    logger.debug('[SentimentDataProvider] Getting sentiment context');

    try {
      // Get sentiment services
      const sentimentService = runtime.getService('sentiment-analysis');
      const aggregatorService = runtime.getService('sentiment-aggregator');
      const twitterService = runtime.getService('twitter-stream');

      if (!sentimentService || !aggregatorService) {
        logger.warn('[SentimentDataProvider] Sentiment services not available');
        return {
          text: 'Sentiment analysis services are currently unavailable.',
          values: {},
          data: {},
        };
      }

      // Get recent sentiment summary (last 4 hours)
      const watchTerms = (sentimentService as any).getWatchTerms();
      const recentReport = await (aggregatorService as any).generateReport(
        watchTerms,
        4, // Last 4 hours for context
        'summary'
      );

      // Get Twitter activity stats if available
      let twitterStats = null;
      if (twitterService && (twitterService as any).isTwitterAvailable()) {
        try {
          twitterStats = await (twitterService as any).getTwitterStats();
        } catch (error) {
          logger.debug('[SentimentDataProvider] Twitter stats unavailable:', error);
        }
      }

      // Format sentiment context
      const sentimentContext = formatSentimentContext(recentReport, twitterStats);

      return {
        text: sentimentContext,
        values: {
          overallSentiment: recentReport.overallMetrics.averageSentiment.score,
          totalVolume: recentReport.overallMetrics.totalVolume,
          volumeChange: recentReport.overallMetrics.volumeChange,
          sentimentChange: recentReport.overallMetrics.sentimentChange,
          hasAlerts: recentReport.alerts.length > 0,
          alertCount: recentReport.alerts.length,
          topWatchTerm:
            recentReport.breakdowns.length > 0 ? recentReport.breakdowns[0].watchTerm : '',
          dominantNarrative:
            recentReport.narratives.length > 0 ? recentReport.narratives[0].theme : '',
        },
        data: {
          sentimentReport: recentReport,
          twitterStats,
          watchTerms,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('[SentimentDataProvider] Error getting sentiment data:', error);

      return {
        text: 'Unable to retrieve current sentiment data due to a system error.',
        values: {
          error: true,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
};

/**
 * Format sentiment data into readable context for the agent
 */
function formatSentimentContext(report: any, twitterStats: any): string {
  let context = `## Current Sentiment Analysis Context\n\n`;

  // Overall metrics
  const sentimentLabel = getSentimentLabel(report.overallMetrics.averageSentiment.score);
  const sentimentScore = report.overallMetrics.averageSentiment.score;

  context += `**Overall Sentiment (Last 4h):** ${sentimentLabel} (${sentimentScore.toFixed(2)})\n`;
  context += `**Total Posts Analyzed:** ${report.overallMetrics.totalVolume}\n`;

  // Changes from previous period
  if (report.overallMetrics.volumeChange !== 0) {
    const volumeTrend = report.overallMetrics.volumeChange > 0 ? 'increased' : 'decreased';
    context += `**Volume Trend:** ${Math.abs(report.overallMetrics.volumeChange).toFixed(1)}% ${volumeTrend}\n`;
  }

  if (Math.abs(report.overallMetrics.sentimentChange) > 0.05) {
    const sentimentTrend = report.overallMetrics.sentimentChange > 0 ? 'improved' : 'declined';
    context += `**Sentiment Trend:** ${Math.abs(report.overallMetrics.sentimentChange * 100).toFixed(1)}% ${sentimentTrend}\n`;
  }

  // Watch term breakdown
  if (report.breakdowns.length > 0) {
    context += `\n**Watch Term Analysis:**\n`;
    for (const breakdown of report.breakdowns.slice(0, 2)) {
      const termSentiment = getSentimentLabel(breakdown.overallSentiment.score);
      context += `• ${breakdown.watchTerm}: ${breakdown.totalPosts} posts, ${termSentiment} (${breakdown.overallSentiment.score.toFixed(2)})\n`;
    }
  }

  // Active narratives
  if (report.narratives.length > 0) {
    context += `\n**Active Discussion Themes:**\n`;
    for (const narrative of report.narratives.slice(0, 3)) {
      const narrativeSentiment = getSentimentLabel(narrative.sentiment.score);
      context += `• ${narrative.theme}: ${narrative.posts} posts, ${narrativeSentiment}\n`;
    }
  }

  // Alerts
  if (report.alerts.length > 0) {
    context += `\n**Active Alerts:**\n`;
    const highAlerts = report.alerts.filter((a: any) => a.severity === 'high');
    const mediumAlerts = report.alerts.filter((a: any) => a.severity === 'medium');

    if (highAlerts.length > 0) {
      context += `• ${highAlerts.length} HIGH priority alerts\n`;
    }
    if (mediumAlerts.length > 0) {
      context += `• ${mediumAlerts.length} MEDIUM priority alerts\n`;
    }

    // Include most important alert message
    if (report.alerts.length > 0) {
      context += `• Latest: ${report.alerts[0].message}\n`;
    }
  }

  // Twitter specific stats
  if (twitterStats) {
    context += `\n**Twitter Activity (24h):**\n`;
    context += `• Total tweets: ${twitterStats.totalTweets}\n`;
    context += `• Average engagement: ${twitterStats.avgEngagement.toFixed(1)}\n`;

    if (twitterStats.topAuthors.length > 0) {
      context += `• Most active: @${twitterStats.topAuthors[0].username} (${twitterStats.topAuthors[0].posts} posts)\n`;
    }
  }

  // Contextual guidance for responses
  context += `\n**Context for Responses:**\n`;
  if (sentimentScore > 0.3) {
    context += `• Overall sentiment is positive - highlight good news and momentum\n`;
  } else if (sentimentScore < -0.3) {
    context += `• Overall sentiment is negative - acknowledge concerns and provide balanced perspective\n`;
  } else {
    context += `• Sentiment is neutral - focus on factual information and emerging trends\n`;
  }

  if (report.overallMetrics.volumeChange > 50) {
    context += `• High activity detected - there may be breaking news or significant developments\n`;
  }

  if (report.alerts.length > 0) {
    context += `• Active alerts require attention - consider mentioning significant changes\n`;
  }

  return context;
}

/**
 * Get human-readable sentiment label
 */
function getSentimentLabel(score: number): string {
  if (score > 0.5) return 'Very Positive';
  if (score > 0.2) return 'Positive';
  if (score > -0.2) return 'Neutral';
  if (score > -0.5) return 'Negative';
  return 'Very Negative';
}

/**
 * Provider for historical sentiment trends
 */
export const sentimentTrendsProvider: Provider = {
  name: 'SENTIMENT_TRENDS',
  description: 'Provides historical sentiment trends and pattern analysis',

  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    logger.debug('[SentimentTrendsProvider] Getting trend context');

    try {
      const aggregatorService = runtime.getService('sentiment-aggregator');

      if (!aggregatorService) {
        return {
          text: 'Sentiment trend analysis is currently unavailable.',
          values: {},
          data: {},
        };
      }

      // Get recent memories containing trend analysis
      const trendMemories = await runtime.searchMemories({
        tableName: 'messages',
        embedding: (await runtime.useModel('text-embedding-3-small', {
          text: 'sentiment trend analysis weekly report',
        })) as number[],
        match_threshold: 0.8,
        count: 3,
      });

      let trendsContext = `## Historical Sentiment Trends\n\n`;

      if (trendMemories.length > 0) {
        const latestTrend = trendMemories[0];
        if (
          latestTrend.content &&
          typeof latestTrend.content === 'object' &&
          'trend_insights' in latestTrend.content
        ) {
          const insights = (latestTrend.content as any).trend_insights;

          trendsContext += `**Recent Trend Analysis:**\n`;
          trendsContext += `• Overall sentiment trend: ${insights.sentimentTrend}\n`;
          trendsContext += `• Volume trend: ${insights.volumeTrend}\n`;
          trendsContext += `• Alert activity: ${insights.alertSummary.total} total (${insights.alertSummary.highSeverity} high priority)\n`;

          if (insights.dominantNarratives.length > 0) {
            trendsContext += `• Dominant narrative: ${insights.dominantNarratives[0].theme}\n`;
          }
        }
      } else {
        trendsContext += `No historical trend data available yet. This information will be populated as the system collects more data over time.`;
      }

      return {
        text: trendsContext,
        values: {
          hasTrendData: trendMemories.length > 0,
          trendMemoryCount: trendMemories.length,
        },
        data: {
          trendMemories,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('[SentimentTrendsProvider] Error getting trend data:', error);

      return {
        text: 'Unable to retrieve sentiment trend data.',
        values: { error: true },
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  },
};
