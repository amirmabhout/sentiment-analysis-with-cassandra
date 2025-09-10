import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { SentimentReport } from '../types.ts';

/**
 * Discord reporting service that extends Discord functionality for sentiment reporting
 * Provides methods to send formatted sentiment reports to specified Discord channels
 */
export class DiscordReportingService extends Service {
  static serviceType = 'discord-reporting';
  capabilityDescription = 'Extends Discord service with sentiment report formatting and sending';

  private channelIds: string[] = [];

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.loadConfiguration();
  }

  static async start(runtime: IAgentRuntime): Promise<DiscordReportingService> {
    logger.info('📨 Starting Discord Reporting Service');
    const service = new DiscordReportingService(runtime);
    await service.initialize();
    return service;
  }

  async stop(): Promise<void> {
    logger.info('📨 Stopping Discord Reporting Service');
  }

  private loadConfiguration(): void {
    // Load CHANNEL_IDS from environment
    const channelIds = process.env.CHANNEL_IDS;
    if (channelIds) {
      this.channelIds = channelIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    }

    logger.info(
      `[DiscordReporting] Configuration loaded: ${this.channelIds.length} channels configured`
    );

    if (this.channelIds.length === 0) {
      logger.warn('[DiscordReporting] No CHANNEL_IDS configured - reports will not be sent');
    }
  }

  private async initialize(): Promise<void> {
    logger.info(
      '[DiscordReporting] Discord Reporting Service initialized - using runtime.sendMessageToTarget'
    );
  }

  /**
   * Send a sentiment report to all configured Discord channels
   */
  async sendSentimentReport(report: SentimentReport): Promise<boolean> {
    if (this.channelIds.length === 0) {
      logger.warn('[DiscordReporting] No channels configured');
      return false;
    }

    const formattedReport = this.formatReportForDiscord(report);
    let successCount = 0;

    for (const channelId of this.channelIds) {
      try {
        await this.runtime.sendMessageToTarget(
          {
            source: 'discord',
            channelId: channelId,
          },
          {
            text: formattedReport,
          }
        );
        successCount++;
        logger.info(`[DiscordReporting] Sentiment report sent to channel ${channelId}`);
      } catch (error) {
        logger.error(`[DiscordReporting] Failed to send report to channel ${channelId}:`, error);
      }
    }

    logger.info(
      `[DiscordReporting] Report sent to ${successCount}/${this.channelIds.length} channels`
    );
    return successCount > 0;
  }

  /**
   * Send a detailed sentiment report with top tweets to all configured Discord channels
   */
  async sendDetailedSentimentReport(report: SentimentReport, topTweets?: any): Promise<boolean> {
    if (this.channelIds.length === 0) {
      logger.warn('[DiscordReporting] No channels configured');
      return false;
    }

    const formattedReport = this.formatDetailedReportForDiscord(report, topTweets);
    let successCount = 0;

    for (const channelId of this.channelIds) {
      try {
        await this.runtime.sendMessageToTarget(
          {
            source: 'discord',
            channelId: channelId,
          },
          {
            text: formattedReport,
          }
        );
        successCount++;
        logger.info(`[DiscordReporting] Detailed sentiment report sent to channel ${channelId}`);
      } catch (error) {
        logger.error(
          `[DiscordReporting] Failed to send detailed report to channel ${channelId}:`,
          error
        );
      }
    }

    logger.info(
      `[DiscordReporting] Detailed report sent to ${successCount}/${this.channelIds.length} channels`
    );
    return successCount > 0;
  }

  /**
   * Format sentiment report for Discord posting (regular report)
   */
  private formatReportForDiscord(report: SentimentReport): string {
    const emoji = this.getSentimentEmoji(report.overallMetrics.averageSentiment.score);
    const trendEmoji = this.getTrendEmoji(report.overallMetrics.sentimentChange);

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
        const termEmoji = this.getSentimentEmoji(breakdown.overallSentiment.score);
        formatted +=
          `• **${breakdown.watchTerm}**: ${breakdown.totalPosts} posts, ` +
          `sentiment ${breakdown.overallSentiment.score.toFixed(2)} ${termEmoji}\n`;
      }
      formatted += '\n';
    }

    // Alerts if any
    if (report.alerts.length > 0) {
      formatted += `🚨 **Active Alerts:**\n`;
      const sortedAlerts = report.alerts
        .sort((a, b) => {
          const severityOrder = { high: 3, medium: 2, low: 1 };
          return (
            (severityOrder[b.severity as keyof typeof severityOrder] || 0) -
            (severityOrder[a.severity as keyof typeof severityOrder] || 0)
          );
        })
        .slice(0, 3);

      for (const alert of sortedAlerts) {
        const alertEmoji = this.getAlertEmoji(alert.type, alert.severity);
        formatted += `${alertEmoji} **${alert.severity.toUpperCase()}**: ${alert.message}\n`;
      }
      formatted += '\n';
    }

    // Summary insight
    const sentimentLabel = this.getSentimentLabel(report.overallMetrics.averageSentiment.score);
    formatted += `**Summary:** ${sentimentLabel} sentiment across ${report.overallMetrics.totalVolume} posts.`;

    return formatted;
  }

  /**
   * Format detailed sentiment report with top tweets for Discord
   */
  private formatDetailedReportForDiscord(report: SentimentReport, topTweets?: any): string {
    let formatted = this.formatReportForDiscord(report);

    // Add top tweets section if provided
    if (
      topTweets &&
      (topTweets.positiveTweets?.length > 0 || topTweets.negativeTweets?.length > 0)
    ) {
      formatted += '\n\n---\n\n';
      formatted += `📈 **Top Sentiment Highlights**\n\n`;

      // Top 3 positive tweets
      if (topTweets.positiveTweets && topTweets.positiveTweets.length > 0) {
        formatted += `**🟢 Top Positive Tweets:**\n`;
        for (let i = 0; i < Math.min(3, topTweets.positiveTweets.length); i++) {
          const rankedTweet = topTweets.positiveTweets[i];
          formatted += this.formatTweetForDiscord(rankedTweet, i + 1);
        }
        formatted += '\n';
      }

      // Top 3 negative tweets
      if (topTweets.negativeTweets && topTweets.negativeTweets.length > 0) {
        formatted += `**🔴 Top Negative Tweets:**\n`;
        for (let i = 0; i < Math.min(3, topTweets.negativeTweets.length); i++) {
          const rankedTweet = topTweets.negativeTweets[i];
          formatted += this.formatTweetForDiscord(rankedTweet, i + 1);
        }
      }
    }

    return formatted;
  }

  /**
   * Format individual tweet for Discord display
   */
  private formatTweetForDiscord(rankedTweet: any, index: number): string {
    const { tweet, sentiment } = rankedTweet;
    const author = `@${tweet.author.username}`;
    const followers = this.formatFollowerCount(tweet.author.followerCount || 0);
    const sentimentScore = sentiment.sentiment.score > 0 ? '+' : '';
    const importance = (rankedTweet.importanceScore * 100).toFixed(0);
    const content = this.truncateText(tweet.content.text, 120);

    return (
      `**${index}.** ${author} (${followers})\n` +
      `   Sentiment: ${sentimentScore}${sentiment.sentiment.score.toFixed(2)} | Importance: ${importance}%\n` +
      `   "${content}"\n\n`
    );
  }

  /**
   * Helper methods for formatting
   */
  private getSentimentEmoji(score: number): string {
    if (score > 0.5) return '🟢';
    if (score > 0.1) return '🔵';
    if (score > -0.1) return '⚪';
    if (score > -0.5) return '🟡';
    return '🔴';
  }

  private getTrendEmoji(change: number): string {
    if (Math.abs(change) < 0.05) return '➡️';
    return change > 0 ? '📈' : '📉';
  }

  private getAlertEmoji(type: string, severity: string): string {
    if (severity === 'high') {
      return type.includes('negative') ? '🚨' : '⚡';
    }
    if (severity === 'medium') {
      return '⚠️';
    }
    return 'ℹ️';
  }

  private getSentimentLabel(score: number): string {
    if (score > 0.5) return 'Very positive';
    if (score > 0.2) return 'Positive';
    if (score > -0.2) return 'Neutral';
    if (score > -0.5) return 'Negative';
    return 'Very negative';
  }

  private formatFollowerCount(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M followers`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(0)}K followers`;
    }
    return `${count} followers`;
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Get configured channel IDs
   */
  getChannelIds(): string[] {
    return [...this.channelIds];
  }

  /**
   * Check if Discord reporting is available
   */
  isAvailable(): boolean {
    return this.channelIds.length > 0;
  }
}
