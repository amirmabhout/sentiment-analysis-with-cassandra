import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { SentimentReport, SocialMediaPost, ProcessedSentiment, TopVoice } from '../types.ts';
import type { SentimentAggregatorService } from './aggregator.ts';
import type { TopVoicesService } from './top-voices.ts';
import type { SentimentPersistenceService } from './persistence.ts';
import { formatUsernameWithCabal } from '../utils/cabal.ts';

/**
 * Unified Report Generation Service
 * Single source of truth for generating and formatting sentiment reports
 * Used by both actions (on-demand) and tasks (scheduled 6h/24h)
 */
export class ReportGenerationService extends Service {
  static serviceType = 'report-generation';
  capabilityDescription =
    'Unified service for generating and formatting sentiment analysis reports';

  private aggregatorService: SentimentAggregatorService;
  private topVoicesService: TopVoicesService | undefined;
  private persistenceService: SentimentPersistenceService;

  constructor(runtime: IAgentRuntime) {
    super(runtime);

    this.aggregatorService = runtime.getService(
      'sentiment-aggregator'
    ) as SentimentAggregatorService;
    this.persistenceService = runtime.getService(
      'sentiment-persistence'
    ) as SentimentPersistenceService;
    this.topVoicesService = runtime.getService('top-voices') as TopVoicesService | undefined;
  }

  static async start(runtime: IAgentRuntime): Promise<ReportGenerationService> {
    logger.info('📊 Starting Report Generation Service');
    return new ReportGenerationService(runtime);
  }

  async stop(): Promise<void> {
    logger.info('📊 Stopping Report Generation Service');
  }

  /**
   * Generate a comprehensive sentiment report for a given timeframe
   * This is the main entry point used by actions and tasks
   */
  async generateReport(
    watchTerms: string[],
    timeframeHours: number,
    reportType: 'summary' | 'detailed' | 'alert' = 'detailed'
  ): Promise<SentimentReport> {
    logger.info(
      `[ReportGeneration] Generating ${reportType} report for last ${timeframeHours} hours`
    );

    // Use aggregator to generate the base report
    const report = await (this.aggregatorService as any).generateReport(
      watchTerms,
      timeframeHours,
      reportType
    );

    // Add top voices if service is available and it's a detailed report
    if (reportType === 'detailed' && this.topVoicesService) {
      try {
        const endTime = Date.now();
        const startTime = endTime - timeframeHours * 60 * 60 * 1000;
        const topVoices = await (this.topVoicesService as any).getTopVoicesForReport(
          startTime,
          endTime,
          50 // Get top 50 for reports
        );
        if (topVoices && topVoices.length > 0) {
          report.topVoices = topVoices;
        }
      } catch (error) {
        logger.warn('[ReportGeneration] Failed to add top voices to report:', error);
      }
    }

    // Store report in persistence if available
    if (this.persistenceService) {
      try {
        await this.persistenceService.storeReport(report);
      } catch (error) {
        logger.warn('[ReportGeneration] Failed to persist report:', error);
      }
    }

    logger.info(
      `[ReportGeneration] Generated ${reportType} report: ${report.overallMetrics.totalVolume} posts analyzed`
    );

    return report;
  }

  /**
   * Get top sentiment tweets for a given timeframe
   * Used to enrich reports with actual tweet examples
   */
  async getTopSentimentTweets(
    timeframeHours: number,
    limit: number = 5
  ): Promise<{
    positiveTweets: Array<{ post: SocialMediaPost; sentiment: ProcessedSentiment }>;
    negativeTweets: Array<{ post: SocialMediaPost; sentiment: ProcessedSentiment }>;
  }> {
    if (!this.persistenceService) {
      logger.warn('[ReportGeneration] No persistence service available for top tweets');
      return { positiveTweets: [], negativeTweets: [] };
    }

    const endTime = Date.now();
    const startTime = endTime - timeframeHours * 60 * 60 * 1000;

    // Get sentiment data and tweets
    const sentimentData = await this.persistenceService.getSentimentAnalysisByTimeRange(
      startTime,
      endTime
    );
    const tweets = await this.persistenceService.getTweetsByTimeRange(startTime, endTime);
    
    logger.info(
      `[ReportGeneration] Fetched ${sentimentData.length} sentiment records and ${tweets.length} tweets for top tweets`
    );

    // Create tweet map for fast lookup
    const tweetMap = new Map<string, SocialMediaPost>();
    for (const tweet of tweets) {
      tweetMap.set(tweet.id, tweet);
    }

    // Combine sentiment with tweets and calculate importance
    const combinedData: Array<{
      post: SocialMediaPost;
      sentiment: ProcessedSentiment;
      importanceScore: number;
    }> = [];

    for (const sentiment of sentimentData) {
      const tweet = tweetMap.get(sentiment.postId);
      if (!tweet) continue;

      const importanceScore = this.calculateImportanceScore(sentiment, tweet);
      combinedData.push({ post: tweet, sentiment, importanceScore });
    }

    // Sort by importance score
    combinedData.sort((a, b) => b.importanceScore - a.importanceScore);

    // Get top positive and negative tweets with more inclusive thresholds
    const positiveTweets = combinedData
      .filter((item) => item.sentiment.sentiment.score > 0.05)
      .slice(0, limit)
      .map(({ post, sentiment }) => ({ post, sentiment }));

    const negativeTweets = combinedData
      .filter((item) => item.sentiment.sentiment.score < -0.05)
      .slice(0, limit)
      .map(({ post, sentiment }) => ({ post, sentiment }));

    logger.info(
      `[ReportGeneration] Found ${positiveTweets.length} positive and ${negativeTweets.length} negative top tweets`
    );

    return { positiveTweets, negativeTweets };
  }

  /**
   * Calculate importance score for ranking tweets
   */
  private calculateImportanceScore(sentiment: ProcessedSentiment, tweet: SocialMediaPost): number {
    const sentimentWeight = Math.abs(sentiment.sentiment.score) * sentiment.sentiment.confidence;
    const influenceWeight =
      sentiment.influence.authorInfluence * 0.5 + sentiment.influence.viralityPotential * 0.5;
    const engagementWeight = this.calculateEngagementScore(tweet);

    return sentimentWeight * 0.4 + influenceWeight * 0.3 + engagementWeight * 0.3;
  }

  /**
   * Calculate engagement score from tweet metrics
   */
  private calculateEngagementScore(tweet: SocialMediaPost): number {
    const likes = tweet.metrics.likes || 0;
    const retweets = tweet.metrics.retweets || 0;
    const replies = tweet.metrics.replies || 0;
    const views = tweet.metrics.views || 0;

    const weightedEngagement = likes * 1.0 + retweets * 2.0 + replies * 1.5 + views * 0.01;
    return Math.min(1.0, Math.log10(weightedEngagement + 1) / 4);
  }

  /**
   * Format report for Discord display
   * Unified formatting used by all report outputs
   */
  formatReportForDiscord(report: SentimentReport): string {
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

    // Top narratives
    if (report.narratives && report.narratives.length > 0) {
      formatted += `**Key Narratives:**\n`;
      for (let i = 0; i < Math.min(3, report.narratives.length); i++) {
        const narrative = report.narratives[i];
        const narrativeEmoji = this.getSentimentEmoji(narrative.sentiment.score);
        formatted += `${i + 1}. **${narrative.theme}** (${narrative.posts} posts) ${narrativeEmoji}\n`;
        if (narrative.keyPhrases.length > 0) {
          formatted += `   Key phrases: *${narrative.keyPhrases.slice(0, 3).join(', ')}*\n`;
        }
      }
      formatted += '\n';
    }

    // Top voices (if available)
    if (report.topVoices && report.topVoices.length > 0) {
      formatted += `**Top Voices:**\n`;
      const voicesToShow = report.topVoices.slice(0, 5);
      for (let i = 0; i < voicesToShow.length; i++) {
        const voice = report.topVoices[i];
        const rank = i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
        const formattedUsername = formatUsernameWithCabal(voice.username, true);
        formatted += `${medal} **${formattedUsername}** - ${voice.mentionCount} mentions`;
        if (voice.followerCount) {
          formatted += ` • ${this.formatFollowerCount(voice.followerCount)} followers`;
        }
        if (voice.averageSentiment) {
          const voiceEmoji = this.getSentimentEmoji(voice.averageSentiment.score);
          formatted += ` ${voiceEmoji}`;
        }
        formatted += '\n';
      }
      formatted += '\n';
    }

    // Add alert summary if there are alerts
    if (report.alerts && report.alerts.length > 0) {
      formatted += `\n**🚨 Active Alerts:**\n`;
      for (const alert of report.alerts.slice(0, 3)) {
        const alertEmoji = this.getAlertEmoji(alert.type, alert.severity);
        formatted += `${alertEmoji} **${alert.severity.toUpperCase()}**: ${alert.message}\n`;
      }
      formatted += '\n';
    }

    // Summary insight
    const sentimentLabel = this.getSentimentLabel(report.overallMetrics.averageSentiment.score);
    formatted += `**Summary:** ${sentimentLabel} sentiment across ${report.overallMetrics.totalVolume} posts.`;

    if (report.narratives && report.narratives.length > 0) {
      formatted += ` Primary discussion themes include ${report.narratives
        .slice(0, 2)
        .map((n) => n.theme.toLowerCase())
        .join(' and ')}.`;
    }

    return formatted;
  }

  /**
   * Format report with top tweets for Discord display
   * Enhanced version that includes top positive and negative tweet examples
   */
  formatReportWithTopTweets(
    report: SentimentReport,
    topTweets: {
      positiveTweets: Array<{ post: SocialMediaPost; sentiment: ProcessedSentiment }>;
      negativeTweets: Array<{ post: SocialMediaPost; sentiment: ProcessedSentiment }>;
    }
  ): string {
    // Start with the base report format
    let formatted = this.formatReportForDiscord(report);

    // Add top tweets section if we have tweets
    if (
      (topTweets.positiveTweets && topTweets.positiveTweets.length > 0) ||
      (topTweets.negativeTweets && topTweets.negativeTweets.length > 0)
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
   * Format individual tweet for Discord display with URL
   */
  private formatTweetForDiscord(
    rankedTweet: { post: SocialMediaPost; sentiment: ProcessedSentiment; importanceScore?: number },
    index: number
  ): string {
    const { post: tweet, sentiment } = rankedTweet;
    const author = formatUsernameWithCabal(tweet.author.username, true);
    const followers = this.formatFollowerCount(tweet.author.followerCount || 0);
    const sentimentScore = sentiment.sentiment.score > 0 ? '+' : '';
    const importance = rankedTweet.importanceScore
      ? (rankedTweet.importanceScore * 100).toFixed(0)
      : '85'; // Default importance if not calculated
    const content = this.truncateText(tweet.content.text, 120);
    const tweetUrl =
      tweet.content.url || `https://twitter.com/${tweet.author.username}/status/${tweet.id}`;

    return (
      `**${index}.** ${author} (${followers})\n` +
      `   Sentiment: ${sentimentScore}${sentiment.sentiment.score.toFixed(2)} | Importance: ${importance}%\n` +
      `   "${content}"\n` +
      `   [View Tweet](<${tweetUrl}>)\n\n`
    );
  }

  /**
   * Truncate text to a maximum length, adding ellipsis if needed
   */
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

    // Dominant themes (topics)
    if (metrics.dominantIndicators && metrics.dominantIndicators.length > 0) {
      section += `• Key themes: *${metrics.dominantIndicators.join(', ')}*\n`;
    }

    return section;
  }

  /**
   * Helper functions for formatting
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
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  }
}
