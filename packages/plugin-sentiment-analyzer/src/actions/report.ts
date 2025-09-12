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
      const aggregatorService = runtime.getService('sentiment-aggregator');
      const topVoicesService = runtime.getService('top-voices');

      if (!sentimentService || !aggregatorService) {
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

      // Generate the report
      const watchTerms = (sentimentService as any).getWatchTerms() as string[];
      const report = await (aggregatorService as any).generateReport(
        watchTerms,
        timeframe.hours,
        reportType
      );

      // Add top voices to the report if service is available
      if (topVoicesService) {
        try {
          const endTime = Date.now();
          const startTime = endTime - timeframe.hours * 60 * 60 * 1000;
          const topVoices = await (topVoicesService as any).getTopVoicesForReport(
            startTime,
            endTime,
            50 // Get top 50 for reports
          );
          if (topVoices && topVoices.length > 0) {
            report.topVoices = topVoices;
          }
        } catch (error) {
          logger.warn('[SentimentReport] Failed to add top voices to report:', error);
        }
      }

      // Format the report for Discord
      const formattedReport = formatReportForDiscord(report);

      // Send the report
      if (callback) {
        await callback({
          text: formattedReport,
          action: 'SENTIMENT_REPORT',
        });

        // If there are alerts, send them separately
        if (report.alerts.length > 0) {
          const alertsSummary = formatAlertsForDiscord(report.alerts);
          await callback({
            text: `🚨 **Alerts Detected:**\n${alertsSummary}`,
            action: 'SENTIMENT_ALERTS',
          });
        }
      }

      logger.info(`[SentimentReport] Successfully generated and sent sentiment report`);

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

/**
 * Format sentiment report for Discord posting
 */
function formatReportForDiscord(report: SentimentReport): string {
  const emoji = getSentimentEmoji(report.overallMetrics.averageSentiment.score);
  const trendEmoji = getTrendEmoji(report.overallMetrics.sentimentChange);

  let formatted = `📊 **Sentiment Analysis Report - ${report.timeframe.label}**\n\n`;

  // Overall metrics
  formatted += `**Overall Metrics:**\n`;
  formatted += `• Total posts analyzed: **${report.overallMetrics.totalVolume}**\n`;
  formatted += `• Average sentiment: **${report.overallMetrics.averageSentiment.score.toFixed(2)}** ${emoji}\n`;

  if (report.overallMetrics.volumeChange !== 0) {
    const volumeChangeStr = report.overallMetrics.volumeChange > 0 ? '+' : '';
    formatted += `• Volume change: **${volumeChangeStr}${report.overallMetrics.volumeChange.toFixed(1)}%**\n`;
  }

  if (report.overallMetrics.sentimentChange !== 0) {
    const sentimentChangeStr = report.overallMetrics.sentimentChange > 0 ? '+' : '';
    formatted += `• Sentiment change: **${sentimentChangeStr}${(report.overallMetrics.sentimentChange * 100).toFixed(1)}%** ${trendEmoji}\n`;
  }

  formatted += '\n';

  // Watch term breakdowns (top 3)
  if (report.breakdowns.length > 0) {
    formatted += `**Watch Term Analysis:**\n`;
    for (const breakdown of report.breakdowns.slice(0, 3)) {
      const termEmoji = getSentimentEmoji(breakdown.overallSentiment.score);
      formatted +=
        `• **${breakdown.watchTerm}**: ${breakdown.totalPosts} posts, ` +
        `sentiment ${breakdown.overallSentiment.score.toFixed(2)} ${termEmoji}\n`;
    }
    formatted += '\n';
  }

  // Top narratives
  if (report.narratives.length > 0) {
    formatted += `**Key Narratives:**\n`;
    for (let i = 0; i < Math.min(3, report.narratives.length); i++) {
      const narrative = report.narratives[i];
      const narrativeEmoji = getSentimentEmoji(narrative.sentiment.score);
      formatted += `${i + 1}. **${narrative.theme}** (${narrative.posts} posts) ${narrativeEmoji}\n`;
      if (narrative.keyPhrases.length > 0) {
        formatted += `   Key phrases: *${narrative.keyPhrases.slice(0, 3).join(', ')}*\n`;
      }
    }
    formatted += '\n';
  }

  // Top entities (if available)
  const topEntities = report.breakdowns.flatMap((b) => b.topEntities).slice(0, 3);
  if (topEntities.length > 0) {
    formatted += `**Top Mentioned Entities:**\n`;
    for (const entityData of topEntities) {
      const entityEmoji = getSentimentEmoji(entityData.avgSentiment.score);
      formatted += `• **${entityData.entity.text}** (${entityData.mentions} mentions) ${entityEmoji}\n`;
    }
    formatted += '\n';
  }

  // Top voices (if available)
  if (report.topVoices && report.topVoices.length > 0) {
    formatted += `**Top Voices:**\n`;
    const voicesToShow = report.topVoices.slice(0, 5); // Show top 5 in main report
    for (let i = 0; i < voicesToShow.length; i++) {
      const voice = report.topVoices[i];
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      formatted += `${medal} **@${voice.username}** - ${voice.mentionCount} mentions`;
      if (voice.followerCount) {
        formatted += ` • ${formatFollowerCount(voice.followerCount)} followers`;
      }
      if (voice.averageSentiment) {
        const voiceEmoji = getSentimentEmoji(voice.averageSentiment.score);
        formatted += ` ${voiceEmoji}`;
      }
      formatted += '\n';
    }
    formatted += '\n';
  }

  // Summary insight
  const sentimentLabel = getSentimentLabel(report.overallMetrics.averageSentiment.score);
  formatted += `**Summary:** ${sentimentLabel} sentiment across ${report.overallMetrics.totalVolume} posts. `;

  if (report.narratives.length > 0) {
    formatted += `Primary discussion themes include ${report.narratives
      .slice(0, 2)
      .map((n) => n.theme.toLowerCase())
      .join(' and ')}.`;
  }

  return formatted;
}

/**
 * Format alerts for Discord
 */
function formatAlertsForDiscord(alerts: any[]): string {
  let formatted = '';

  const sortedAlerts = alerts.sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    return (
      (severityOrder[b.severity as keyof typeof severityOrder] || 0) -
      (severityOrder[a.severity as keyof typeof severityOrder] || 0)
    );
  });

  for (const alert of sortedAlerts) {
    const alertEmoji = getAlertEmoji(alert.type, alert.severity);
    formatted += `${alertEmoji} **${alert.severity.toUpperCase()}**: ${alert.message}\n`;
  }

  return formatted;
}

/**
 * Get emoji for sentiment score
 */
function getSentimentEmoji(score: number): string {
  if (score > 0.5) return '🟢';
  if (score > 0.1) return '🔵';
  if (score > -0.1) return '⚪';
  if (score > -0.5) return '🟡';
  return '🔴';
}

/**
 * Get emoji for trend direction
 */
function getTrendEmoji(change: number): string {
  if (Math.abs(change) < 0.05) return '➡️';
  return change > 0 ? '📈' : '📉';
}

/**
 * Get alert emoji based on type and severity
 */
function getAlertEmoji(type: string, severity: string): string {
  if (severity === 'high') {
    return type.includes('negative') ? '🚨' : '⚡';
  }
  if (severity === 'medium') {
    return '⚠️';
  }
  return 'ℹ️';
}

/**
 * Get human-readable sentiment label
 */
function getSentimentLabel(score: number): string {
  if (score > 0.5) return 'Very positive';
  if (score > 0.2) return 'Positive';
  if (score > -0.2) return 'Neutral';
  if (score > -0.5) return 'Negative';
  return 'Very negative';
}

/**
 * Format follower count for display
 */
function formatFollowerCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}
