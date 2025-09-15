import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { SentimentReport } from '../types.ts';
import type { ReportGenerationService } from './report-generation.ts';

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
   * Send a detailed sentiment report with top tweets to all configured Discord channels
   */
  async sendDetailedSentimentReport(report: SentimentReport, topTweets?: any): Promise<boolean> {
    if (this.channelIds.length === 0) {
      logger.warn('[DiscordReporting] No channels configured');
      return false;
    }

    // Use unified formatting from ReportGenerationService
    const reportGenerationService = this.runtime.getService(
      'report-generation'
    ) as ReportGenerationService;
    
    let formattedReport: string;
    if (reportGenerationService && topTweets) {
      // Use new enhanced formatting that includes top tweets
      formattedReport = reportGenerationService.formatReportWithTopTweets(report, topTweets);
    } else if (reportGenerationService) {
      // Standard formatting without top tweets
      formattedReport = reportGenerationService.formatReportForDiscord(report);
    } else {
      // Legacy fallback
      formattedReport = this.formatDetailedReportForDiscord(report, topTweets);
    }
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
   * Format detailed sentiment report with top tweets for Discord
   * @deprecated Legacy fallback - use ReportGenerationService.formatReportForDiscord() instead
   */
  private formatDetailedReportForDiscord(report: SentimentReport, topTweets?: any): string {
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

    // Category-specific sections
    if (report.categoryMetrics) {
      // Trading & Speculation Section
      formatted += `📈 **=== TRADING & SPECULATION ===**\n`;
      formatted += this.formatCategorySection(report.categoryMetrics.trading, 'trading');
      formatted += '\n';

      // Technology & Community Section
      formatted += `🛠️ **=== TECHNOLOGY & COMMUNITY ===**\n`;
      formatted += this.formatCategorySection(report.categoryMetrics.technology, 'technology');
      formatted += '\n';
    }

    // Alerts if any
    if (report.alerts && report.alerts.length > 0) {
      formatted += `\n**🚨 Active Alerts:**\n`;
      for (const alert of report.alerts.slice(0, 3)) {
        const alertEmoji = this.getAlertEmoji(alert.type, alert.severity);
        formatted += `${alertEmoji} **${alert.severity.toUpperCase()}**: ${alert.message}\n`;
      }
      formatted += '\n';
    }

    // Add top tweets section if provided (legacy fallback)
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

    // Summary insight
    const sentimentLabel = this.getSentimentLabel(report.overallMetrics.averageSentiment.score);
    formatted += `\n**Summary:** ${sentimentLabel} sentiment across ${report.overallMetrics.totalVolume} posts.`;

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
    const tweetUrl =
      tweet.content.url || `https://twitter.com/${tweet.author.username}/status/${tweet.id}`;

    return (
      `**${index}.** ${author} (${followers})\n` +
      `   Sentiment: ${sentimentScore}${sentiment.sentiment.score.toFixed(2)} | Importance: ${importance}%\n` +
      `   "${content}"\n` +
      `   [View Tweet](${tweetUrl})\n\n`
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
   * Format category section for Discord
   */
  private formatCategorySection(metrics: any, category: string): string {
    if (!metrics || metrics.totalVolume === 0) {
      return `*No ${category === 'trading' ? 'trading/speculation' : 'technology/community'} posts in this period*\n`;
    }

    const emoji = this.getSentimentEmoji(metrics.averageSentiment.score);
    let section = '';

    // Basic metrics
    section += `• Total posts: **${metrics.totalVolume}**\n`;
    section += `• Average sentiment: **${metrics.averageSentiment.score.toFixed(2)}** ${emoji}\n`;

    if (metrics.volumeChange !== 0) {
      const changeStr = metrics.volumeChange > 0 ? '+' : '';
      section += `• Volume change: **${changeStr}${metrics.volumeChange.toFixed(1)}%**\n`;
    }

    if (metrics.sentimentChange !== 0) {
      const changeStr = metrics.sentimentChange > 0 ? '+' : '';
      section += `• Sentiment change: **${changeStr}${(metrics.sentimentChange * 100).toFixed(1)}%**\n`;
    }

    // Dominant indicators
    if (metrics.dominantIndicators && metrics.dominantIndicators.length > 0) {
      section += `• Key themes: *${metrics.dominantIndicators.join(', ')}*\n`;
    }

    section += '\n';

    // Top positive posts
    if (metrics.topPositivePosts && metrics.topPositivePosts.length > 0) {
      section += `**🟢 Top Positive ${category === 'trading' ? 'Trading' : 'Technology'} Tweets:**\n`;
      for (let i = 0; i < Math.min(3, metrics.topPositivePosts.length); i++) {
        const item = metrics.topPositivePosts[i];
        const tweet = item.post;
        const sentiment = item.sentiment;
        const tweetUrl =
          tweet.content.url || `https://twitter.com/${tweet.author.username}/status/${tweet.id}`;

        section += `${i + 1}. **@${tweet.author.username}**`;
        if (tweet.author.followerCount) {
          section += ` (${this.formatFollowerCountSimple(tweet.author.followerCount)} followers)`;
        }
        section += `\n`;
        section += `   Sentiment: **${sentiment.sentiment.score > 0 ? '+' : ''}${sentiment.sentiment.score.toFixed(2)}** | `;
        section += `Importance: **${(item.importanceScore * 100).toFixed(0)}%**\n`;
        section += `   *"${tweet.content.text.substring(0, 150)}${tweet.content.text.length > 150 ? '...' : ''}"*\n`;
        section += `   [View Tweet](${tweetUrl})\n\n`;
      }
    }

    // Top negative posts
    if (metrics.topNegativePosts && metrics.topNegativePosts.length > 0) {
      section += `**🔴 Top Negative ${category === 'trading' ? 'Trading' : 'Technology'} Tweets:**\n`;
      for (let i = 0; i < Math.min(3, metrics.topNegativePosts.length); i++) {
        const item = metrics.topNegativePosts[i];
        const tweet = item.post;
        const sentiment = item.sentiment;
        const tweetUrl =
          tweet.content.url || `https://twitter.com/${tweet.author.username}/status/${tweet.id}`;

        section += `${i + 1}. **@${tweet.author.username}**`;
        if (tweet.author.followerCount) {
          section += ` (${this.formatFollowerCountSimple(tweet.author.followerCount)} followers)`;
        }
        section += `\n`;
        section += `   Sentiment: **${sentiment.sentiment.score.toFixed(2)}** | `;
        section += `Importance: **${(item.importanceScore * 100).toFixed(0)}%**\n`;
        section += `   *"${tweet.content.text.substring(0, 150)}${tweet.content.text.length > 150 ? '...' : ''}"*\n`;
        section += `   [View Tweet](${tweetUrl})\n\n`;
      }
    }

    return section;
  }

  /**
   * Format follower count for display (simplified)
   */
  private formatFollowerCountSimple(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
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
