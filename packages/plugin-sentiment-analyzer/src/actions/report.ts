import {
  type Action,
  type ActionResult,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
  parseKeyValueXml,
} from '@elizaos/core';
import type { SentimentReport } from '../types.ts';
import type { ReportGenerationService } from '../services/report-generation.ts';

/**
 * Action for generating and posting sentiment reports to Discord
 */
export const sentimentReportAction: Action = {
  name: 'SENTIMENT_REPORT',
  similes: ['GENERATE_SENTIMENT_REPORT', 'SHOW_SENTIMENT', 'SENTIMENT_ANALYSIS'],
  description: 'Generate and post sentiment analysis reports about ai16z and elizaOS',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    logger.debug('[SentimentReport] Validating sentiment report action');

    const text = message.content.text?.toLowerCase() || '';

    // Check if the message is asking for sentiment analysis/reports
    const sentimentKeywords = [
      'sentiment',
      'analysis',
      'report',
      'ai16z',
      'elizaos',
      'social media',
      'twitter',
      'mood',
      'opinion',
      'perception',
    ];

    const hasSentimentKeyword = sentimentKeywords.some((keyword) => text.includes(keyword));

    // Check for report-related keywords
    const reportKeywords = ['report', 'summary', 'update', 'analysis', 'breakdown'];
    const hasReportKeyword = reportKeywords.some((keyword) => text.includes(keyword));

    const isValid = hasSentimentKeyword && hasReportKeyword;

    if (isValid) {
      logger.info('[SentimentReport] Sentiment report action validated');
    } else {
      logger.debug('[SentimentReport] Message does not match sentiment report criteria');
    }

    return isValid;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info('[SentimentReport] Generating sentiment report');

    try {
      // Get required services
      const sentimentService = runtime.getService('sentiment-analysis');
      const reportGenerationService = runtime.getService(
        'report-generation'
      ) as ReportGenerationService;

      if (!sentimentService || !reportGenerationService) {
        const errorMsg = 'Sentiment analysis services are not available at the moment.';
        if (callback) {
          await callback({
            text: errorMsg,
            error: true,
          });
        }

        return {
          success: false,
          error: new Error('Required services not available'),
          text: errorMsg,
        };
      }

      // Parse the request to determine timeframe
      const text = message.content.text?.toLowerCase() || '';
      const timeframe = extractTimeframe(text);
      const reportType = extractReportType(text);

      logger.info(`[SentimentReport] Generating ${reportType} report for ${timeframe.label}`);

      // Generate the report using unified service
      const watchTerms = (sentimentService as any).getWatchTerms() as string[];
      const report = await reportGenerationService.generateReport(
        watchTerms,
        timeframe.hours,
        reportType
      );

      // Get top sentiment tweets for the same timeframe
      const topTweets = await reportGenerationService.getTopSentimentTweets(timeframe.hours);

      // Format the report with top tweets included
      const formattedReport = reportGenerationService.formatReportWithTopTweets(report, topTweets);

      // Send the report (alerts are already included in formattedReport)
      if (callback) {
        await callback({
          text: formattedReport,
          action: 'SENTIMENT_REPORT',
        });
      }

      logger.info(
        `[SentimentReport] Successfully generated and sent sentiment report with ` +
          `${topTweets.positiveTweets.length} positive and ${topTweets.negativeTweets.length} negative top tweets`
      );

      return {
        success: true,
        text: 'Sentiment report generated successfully',
        values: {
          reportGenerated: true,
          totalPosts: report.overallMetrics.totalVolume,
          alertCount: report.alerts.length,
          timeframe: timeframe.label,
        },
        data: {
          actionName: 'SENTIMENT_REPORT',
          report,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('[SentimentReport] Error generating sentiment report:', error);

      const errorMsg =
        'I encountered an error while generating the sentiment report. Please try again.';
      if (callback) {
        await callback({
          text: errorMsg,
          error: true,
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error || 'Unknown error')),
        text: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Can you give me a sentiment report on ai16z?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '📊 **Sentiment Analysis Report - ai16z & elizaOS**\n\n**Last 24 Hours Summary:**\n• Total mentions: 247 posts\n• Overall sentiment: +0.68 (Positive)\n• Volume change: +12% vs previous period\n\n**Top Narratives:**\n1. Partnership announcements (+0.82 sentiment)\n2. Technical development updates (+0.71 sentiment)\n3. Community growth discussions (+0.65 sentiment)\n\n**Key Insights:**\n• Positive momentum continues with new partnership news\n• Technical updates generating strong community engagement\n• No significant negative trends detected',
          actions: ['SENTIMENT_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Show me the weekly sentiment analysis',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '📈 **Weekly Sentiment Trends - ai16z & elizaOS**\n\n**7-Day Analysis:**\n• Total volume: 1,432 posts\n• Average sentiment: +0.58 (Moderately Positive)\n• Sentiment trend: Rising (+0.14 from previous week)\n• Volume trend: Growing (+28% increase)\n\n**Weekly Highlights:**\n• Major positive spike on Tuesday (+340% volume)\n• Consistent positive sentiment throughout the week\n• Growing developer interest in elizaOS plugins\n\n**Alert Summary:**\n• 2 positive volume spikes detected\n• 0 negative sentiment alerts\n• Strong upward momentum maintained',
          actions: ['SENTIMENT_REPORT'],
        },
      },
    ],
  ],
};

/**
 * Extract timeframe from user message
 */
function extractTimeframe(text: string): { hours: number; label: string } {
  if (text.includes('hour')) {
    if (text.includes('last hour') || text.includes('past hour')) {
      return { hours: 1, label: 'Last 1 hour' };
    }
    // Extract number of hours
    const hourMatch = text.match(/(\d+)\s*hours?/);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1] || '0', 10);
      return { hours, label: `Last ${hours} hours` };
    }
  }

  if (text.includes('day') || text.includes('daily')) {
    if (text.includes('today')) {
      return { hours: 24, label: 'Today' };
    }
    const dayMatch = text.match(/(\d+)\s*days?/);
    if (dayMatch) {
      const days = parseInt(dayMatch[1] || '0', 10);
      return { hours: days * 24, label: `Last ${days} days` };
    }
    return { hours: 24, label: 'Last 24 hours' };
  }

  if (text.includes('week') || text.includes('weekly')) {
    return { hours: 168, label: 'Last 7 days' };
  }

  // Default to 24 hours
  return { hours: 24, label: 'Last 24 hours' };
}

/**
 * Extract report type from user message
 */
function extractReportType(text: string): 'summary' | 'detailed' | 'alert' {
  if (text.includes('detailed') || text.includes('full') || text.includes('comprehensive')) {
    return 'detailed';
  }

  if (text.includes('alert') || text.includes('urgent') || text.includes('warning')) {
    return 'alert';
  }

  return 'summary';
}

// All formatting logic is now handled by the unified ReportGenerationService
