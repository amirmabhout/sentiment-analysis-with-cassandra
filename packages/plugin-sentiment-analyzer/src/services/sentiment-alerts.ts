import { Service, type IAgentRuntime, logger, ModelType } from '@elizaos/core';
import type { ProcessedSentiment, SocialMediaPost } from '../types.ts';

/**
 * Alert data for high-importance negative sentiment
 */
interface SentimentAlert {
  id: string;
  timestamp: number;
  tweet: SocialMediaPost;
  sentiment: ProcessedSentiment;
  importanceScore: number;
  engagementScore: number;
  alertReason: string;
  channelsSent: string[];
}

/**
 * Cooldown tracking for authors
 */
interface AuthorCooldown {
  authorId: string;
  lastAlertTime: number;
  alertCount: number;
}

/**
 * SentimentAlertsService handles real-time alerts for high-importance negative sentiment
 * Monitors sentiment analysis results and sends immediate Discord alerts when thresholds are met
 */
export class SentimentAlertsService extends Service {
  static serviceType = 'sentiment-alerts';
  capabilityDescription =
    'Provides real-time alerts for high-importance negative sentiment detection via Discord';

  private alertHistory: SentimentAlert[] = [];
  private authorCooldowns: Map<string, AuthorCooldown> = new Map();

  // Configuration with sensible defaults
  private config = {
    enabled: true,
    importanceThreshold: 0.7, // Minimum importance score to trigger alert
    negativeThreshold: -0.5, // How negative sentiment must be to trigger
    cooldownMs: 5 * 60 * 1000, // 5 minutes cooldown per author
    maxAlertsPerHour: 10, // Rate limiting
    channelIds: [] as string[], // Discord channel IDs from CHANNEL_IDS env var
  };

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.loadConfiguration();
  }

  static async start(runtime: IAgentRuntime): Promise<SentimentAlertsService> {
    logger.info('🚨 Starting Sentiment Alerts Service');
    const service = new SentimentAlertsService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🚨 Stopping Sentiment Alerts Service');
  }

  /**
   * Load configuration from environment variables with defaults
   */
  private loadConfiguration(): void {
    // Load optional configuration with defaults
    this.config.enabled = process.env.SENTIMENT_ALERT_ENABLED !== 'false';
    this.config.importanceThreshold = parseFloat(
      process.env.SENTIMENT_ALERT_IMPORTANCE_THRESHOLD || '0.7'
    );
    this.config.negativeThreshold = parseFloat(
      process.env.SENTIMENT_ALERT_NEGATIVE_THRESHOLD || '-0.5'
    );
    this.config.cooldownMs = parseInt(process.env.SENTIMENT_ALERT_COOLDOWN || '300000', 10);

    // Parse existing CHANNEL_IDS environment variable
    const channelIds = process.env.CHANNEL_IDS;
    if (channelIds) {
      this.config.channelIds = channelIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    }

    logger.info(
      `[SENTIMENT_ALERTS] Configuration loaded: enabled=${this.config.enabled}, ` +
        `importanceThreshold=${this.config.importanceThreshold}, ` +
        `negativeThreshold=${this.config.negativeThreshold}, ` +
        `cooldown=${this.config.cooldownMs}ms, ` +
        `channels=${this.config.channelIds.length}`
    );
  }

  /**
   * Evaluate a processed sentiment result for alerting
   * This is called immediately after sentiment analysis completes
   */
  async evaluateForAlert(sentiment: ProcessedSentiment, tweet: SocialMediaPost): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      // Calculate engagement score for importance weighting
      const engagementScore = this.calculateEngagementScore(tweet);

      // Calculate composite importance score
      const importanceScore = this.calculateImportanceScore(sentiment, engagementScore);

      // Check if alert criteria are met
      const shouldAlert = this.shouldTriggerAlert(sentiment, tweet, importanceScore);

      if (shouldAlert) {
        logger.info(
          `[SENTIMENT_ALERTS] Alert criteria met for post ${tweet.id}: ` +
            `sentiment=${sentiment.sentiment.score.toFixed(3)}, ` +
            `importance=${importanceScore.toFixed(3)}`
        );

        await this.sendAlert(sentiment, tweet, importanceScore, engagementScore);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`[SENTIMENT_ALERTS] Error evaluating alert for post ${tweet.id}:`, error);
      return false;
    }
  }

  /**
   * Determine if an alert should be triggered based on thresholds and cooldowns
   */
  private shouldTriggerAlert(
    sentiment: ProcessedSentiment,
    tweet: SocialMediaPost,
    importanceScore: number
  ): boolean {
    // Check basic thresholds
    if (sentiment.sentiment.score >= this.config.negativeThreshold) {
      return false; // Not negative enough
    }

    if (importanceScore < this.config.importanceThreshold) {
      return false; // Not important enough
    }

    // Check author cooldown
    if (this.isAuthorOnCooldown(tweet.author.id)) {
      logger.debug(
        `[SENTIMENT_ALERTS] Author ${tweet.author.username} is on cooldown, skipping alert`
      );
      return false;
    }

    // Check rate limiting (max alerts per hour)
    const recentAlerts = this.alertHistory.filter(
      (alert) => Date.now() - alert.timestamp < 60 * 60 * 1000
    );
    if (recentAlerts.length >= this.config.maxAlertsPerHour) {
      logger.warn('[SENTIMENT_ALERTS] Rate limit reached, skipping alert');
      return false;
    }

    return true;
  }

  /**
   * Check if an author is currently on cooldown
   */
  private isAuthorOnCooldown(authorId: string): boolean {
    const cooldown = this.authorCooldowns.get(authorId);
    if (!cooldown) {
      return false;
    }

    const isOnCooldown = Date.now() - cooldown.lastAlertTime < this.config.cooldownMs;
    if (!isOnCooldown) {
      // Cooldown expired, remove it
      this.authorCooldowns.delete(authorId);
    }

    return isOnCooldown;
  }

  /**
   * Send Discord alert for high-importance negative sentiment
   */
  private async sendAlert(
    sentiment: ProcessedSentiment,
    tweet: SocialMediaPost,
    importanceScore: number,
    engagementScore: number
  ): Promise<void> {
    try {
      // Create alert message
      const alertMessage = this.formatAlertMessage(sentiment, tweet, importanceScore);

      const channelsSent: string[] = [];

      // Send to all configured channels using runtime.sendMessageToTarget
      for (const channelId of this.config.channelIds) {
        try {
          await this.runtime.sendMessageToTarget(
            {
              source: 'discord',
              channelId: channelId,
            },
            {
              text: alertMessage,
            }
          );
          channelsSent.push(channelId);
          logger.info(`[SENTIMENT_ALERTS] Alert sent to Discord channel ${channelId}`);
        } catch (error) {
          logger.error(`[SENTIMENT_ALERTS] Failed to send alert to channel ${channelId}:`, error);
        }
      }

      // Record alert in history
      const alert: SentimentAlert = {
        id: `alert_${Date.now()}_${tweet.id}`,
        timestamp: Date.now(),
        tweet,
        sentiment,
        importanceScore,
        engagementScore,
        alertReason: this.getAlertReason(sentiment, importanceScore),
        channelsSent,
      };

      this.alertHistory.push(alert);

      // Update author cooldown
      this.authorCooldowns.set(tweet.author.id, {
        authorId: tweet.author.id,
        lastAlertTime: Date.now(),
        alertCount: (this.authorCooldowns.get(tweet.author.id)?.alertCount || 0) + 1,
      });

      // Cleanup old alerts (keep last 100)
      if (this.alertHistory.length > 100) {
        this.alertHistory = this.alertHistory.slice(-100);
      }

      logger.info(
        `[SENTIMENT_ALERTS] Alert sent successfully for post ${tweet.id} to ${channelsSent.length} channels`
      );
    } catch (error) {
      logger.error(`[SENTIMENT_ALERTS] Failed to send alert for post ${tweet.id}:`, error);
    }
  }

  /**
   * Format the alert message for Discord
   */
  private formatAlertMessage(
    sentiment: ProcessedSentiment,
    tweet: SocialMediaPost,
    importanceScore: number
  ): string {
    const sentimentEmoji = this.getSentimentEmoji(sentiment.sentiment.score);
    const followerCount = this.formatNumber(tweet.author.followerCount || 0);
    const influence = Math.round(sentiment.influence.authorInfluence * 100);
    const confidence = Math.round(sentiment.sentiment.confidence * 100);

    let message = `🚨 **HIGH IMPORTANCE NEGATIVE SENTIMENT ALERT**\n\n`;

    // Author information
    message += `**Author:** @${tweet.author.username} (${followerCount} followers, ${influence}% influence)\n`;
    message += `**Sentiment:** ${sentimentEmoji} ${sentiment.sentiment.score.toFixed(2)} (${this.getSentimentLabel(sentiment.sentiment.score)}, ${confidence}% confident)\n`;

    // Engagement metrics
    const engagement = this.formatEngagementMetrics(tweet);
    if (engagement) {
      message += `**Engagement:** ${engagement}\n`;
    }

    message += `**Importance Score:** ${Math.round(importanceScore * 100)}%\n\n`;

    // Tweet content (truncated if necessary)
    const tweetText =
      tweet.content.text.length > 200
        ? tweet.content.text.substring(0, 197) + '...'
        : tweet.content.text;
    message += `**Tweet Content:**\n"${tweetText}"\n\n`;

    // Context information
    message += `**Context:**\n`;
    message += `• Posted ${this.getTimeAgo(tweet.timestamp)}\n`;
    message += `• Platform: ${tweet.platform}\n`;

    if (sentiment.watchTermsFound.length > 0) {
      message += `• Watch terms: ${sentiment.watchTermsFound.join(', ')}\n`;
    }

    if (tweet.content.url) {
      message += `• Link: ${tweet.content.url}\n`;
    }

    message += `\n**Action Required:** Monitor for escalation and potential response`;

    return message;
  }

  /**
   * Calculate engagement score from tweet metrics (same as top-sentiment-tweets provider)
   */
  private calculateEngagementScore(tweet: SocialMediaPost): number {
    const likes = tweet.metrics.likes || 0;
    const retweets = tweet.metrics.retweets || 0;
    const replies = tweet.metrics.replies || 0;
    const views = tweet.metrics.views || 0;

    // Weight different engagement types
    const weightedEngagement = likes * 1.0 + retweets * 2.0 + replies * 1.5 + views * 0.1;

    // Normalize to 0-1 scale using logarithmic scaling
    const normalized = Math.min(1.0, Math.log10(weightedEngagement + 1) / 4);

    return normalized;
  }

  /**
   * Calculate composite importance score (same as top-sentiment-tweets provider)
   */
  private calculateImportanceScore(sentiment: ProcessedSentiment, engagementScore: number): number {
    const authorWeight = 0.6;
    const sentimentWeight = 0.2;
    const engagementWeight = 0.2;

    const authorInfluence = sentiment.influence.authorInfluence;
    const sentimentMagnitude = sentiment.sentiment.magnitude;

    const score =
      authorInfluence * authorWeight +
      sentimentMagnitude * sentimentWeight +
      engagementScore * engagementWeight;

    return Math.min(1.0, score);
  }

  /**
   * Get emoji representation for sentiment score
   */
  private getSentimentEmoji(score: number): string {
    if (score < -0.7) return '🔴';
    if (score < -0.5) return '🟠';
    if (score < -0.3) return '🟡';
    return '⚪';
  }

  /**
   * Get human-readable sentiment label
   */
  private getSentimentLabel(score: number): string {
    if (score < -0.7) return 'Very Negative';
    if (score < -0.5) return 'Negative';
    if (score < -0.3) return 'Somewhat Negative';
    if (score < -0.1) return 'Slightly Negative';
    return 'Neutral';
  }

  /**
   * Format engagement metrics for display
   */
  private formatEngagementMetrics(tweet: SocialMediaPost): string {
    const parts: string[] = [];

    if (tweet.metrics.likes && tweet.metrics.likes > 0) {
      parts.push(`${this.formatNumber(tweet.metrics.likes)} likes`);
    }
    if (tweet.metrics.retweets && tweet.metrics.retweets > 0) {
      parts.push(`${this.formatNumber(tweet.metrics.retweets)} RTs`);
    }
    if (tweet.metrics.replies && tweet.metrics.replies > 0) {
      parts.push(`${this.formatNumber(tweet.metrics.replies)} replies`);
    }
    if (tweet.metrics.views && tweet.metrics.views > 0) {
      parts.push(`${this.formatNumber(tweet.metrics.views)} views`);
    }

    return parts.length > 0 ? parts.join(', ') : '';
  }

  /**
   * Format numbers for display (1000 -> 1K, 1000000 -> 1M)
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}K`;
    }
    return num.toString();
  }

  /**
   * Get human-readable time ago format
   */
  private getTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /**
   * Get reason for alert trigger
   */
  private getAlertReason(sentiment: ProcessedSentiment, importanceScore: number): string {
    const score = sentiment.sentiment.score;
    const influence = sentiment.influence.authorInfluence;

    if (score < -0.7 && importanceScore > 0.8) {
      return 'Extremely negative sentiment from highly influential account';
    } else if (score < -0.5 && influence > 0.8) {
      return 'Very negative sentiment from major influencer';
    } else if (score < -0.3 && influence > 0.9) {
      return 'Negative sentiment from top-tier influencer';
    } else {
      return 'High-importance negative sentiment detected';
    }
  }

  /**
   * Get alert statistics for monitoring
   */
  getAlertStats(): {
    totalAlerts: number;
    alertsLast24h: number;
    alertsThisHour: number;
    activeCooldowns: number;
    configEnabled: boolean;
  } {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const lastHour = now - 60 * 60 * 1000;

    return {
      totalAlerts: this.alertHistory.length,
      alertsLast24h: this.alertHistory.filter((alert) => alert.timestamp > last24h).length,
      alertsThisHour: this.alertHistory.filter((alert) => alert.timestamp > lastHour).length,
      activeCooldowns: this.authorCooldowns.size,
      configEnabled: this.config.enabled,
    };
  }

  /**
   * Get recent alerts for debugging/monitoring
   */
  getRecentAlerts(limit: number = 10): SentimentAlert[] {
    return this.alertHistory.slice(-limit).reverse();
  }
}
