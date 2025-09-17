import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { v4 } from 'uuid';
import type { TopVoice, TopVoicesReport, SocialMediaPost, ProcessedSentiment } from '../types.ts';
import type { SentimentPersistenceService } from './persistence.ts';
import { formatUsernameWithCabal, filterCabalMembers, getCabalUsernames } from '../utils/cabal.ts';

/**
 * Service for aggregating and reporting on top voices (most mentioned authors)
 */
export class TopVoicesService extends Service {
  static serviceType = 'top-voices';
  capabilityDescription = 'Aggregates and reports on top voices based on mention counts';

  private persistenceService: SentimentPersistenceService;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.persistenceService = runtime.getService(
      'sentiment-persistence'
    ) as SentimentPersistenceService;
  }

  static async start(runtime: IAgentRuntime): Promise<TopVoicesService> {
    logger.info('👥 Starting Top Voices Service');
    return new TopVoicesService(runtime);
  }

  async stop(): Promise<void> {
    logger.info('👥 Stopping Top Voices Service');
  }

  /**
   * Generate a top voices report for a given time period
   */
  async generateTopVoicesReport(hours: number, limit: number = 50): Promise<TopVoicesReport> {
    const endTime = Date.now();
    const startTime = endTime - hours * 60 * 60 * 1000;
    const label =
      hours === 24 ? 'Last 24 hours' : hours === 168 ? 'Last 7 days' : `Last ${hours} hours`;

    logger.info(`[TOP_VOICES] Generating top voices report for ${label}`);

    if (!this.persistenceService) {
      logger.error('[TOP_VOICES] Persistence service not available');
      return this.createEmptyReport(startTime, endTime, label);
    }

    try {
      // Get tweets from the time range
      const tweets = await this.persistenceService.getTweetsByTimeRange(startTime, endTime);

      // Also get sentiment analysis data for average sentiment calculation
      const sentimentData = await this.persistenceService.getSentimentAnalysisByTimeRange(
        startTime,
        endTime
      );

      logger.info(`[TOP_VOICES] Processing ${tweets.length} tweets for top voices`);

      // Aggregate by author
      const authorMap = new Map<
        string,
        {
          username: string;
          name?: string;
          mentionCount: number;
          followerCount?: number;
          platforms: Set<string>;
          sentimentScores: number[];
          tweetIds: string[];
        }
      >();

      // Process tweets
      for (const tweet of tweets) {
        const key = tweet.author.username.toLowerCase();

        if (!authorMap.has(key)) {
          authorMap.set(key, {
            username: tweet.author.username,
            name: tweet.author.name,
            mentionCount: 0,
            followerCount: tweet.author.followerCount,
            platforms: new Set(),
            sentimentScores: [],
            tweetIds: [],
          });
        }

        const author = authorMap.get(key)!;
        author.mentionCount++;
        author.platforms.add(tweet.platform);
        author.tweetIds.push(tweet.id);

        // Update follower count if higher (in case of multiple tweets from same author)
        if (
          tweet.author.followerCount &&
          (!author.followerCount || tweet.author.followerCount > author.followerCount)
        ) {
          author.followerCount = tweet.author.followerCount;
        }
      }

      // Add sentiment scores
      for (const sentiment of sentimentData) {
        // Find matching author by tweet ID
        for (const [key, author] of authorMap.entries()) {
          if (author.tweetIds.includes(sentiment.postId)) {
            author.sentimentScores.push(sentiment.sentiment.score);
            break;
          }
        }
      }

      // Convert to array and calculate average sentiments
      const topVoices: TopVoice[] = Array.from(authorMap.values())
        .map((author) => {
          const avgSentiment =
            author.sentimentScores.length > 0
              ? author.sentimentScores.reduce((a, b) => a + b, 0) / author.sentimentScores.length
              : undefined;

          // Get recent tweet IDs for this author (up to 3 most recent)
          const recentTweetIds = author.tweetIds.slice(-3);
          const sampleTweetUrls = recentTweetIds.map(
            (tweetId) => `https://twitter.com/${author.username}/status/${tweetId}`
          );

          return {
            username: author.username,
            name: author.name,
            mentionCount: author.mentionCount,
            followerCount: author.followerCount,
            averageSentiment:
              avgSentiment !== undefined
                ? {
                    score: avgSentiment,
                    confidence: 0.8, // Default confidence
                    magnitude: Math.abs(avgSentiment),
                    label: this.getSentimentLabel(avgSentiment),
                  }
                : undefined,
            platforms: Array.from(author.platforms),
            sampleTweetUrls, // Add sample tweet URLs
          };
        })
        .sort((a, b) => b.mentionCount - a.mentionCount)
        .slice(0, limit);

      const report: TopVoicesReport = {
        id: v4(),
        timeframe: {
          start: startTime,
          end: endTime,
          label,
        },
        totalUniqueAuthors: authorMap.size,
        totalMentions: tweets.length,
        topVoices,
        generatedAt: Date.now(),
      };

      logger.info(
        `[TOP_VOICES] Generated report with ${topVoices.length} top voices from ${authorMap.size} unique authors`
      );

      return report;
    } catch (error) {
      logger.error('[TOP_VOICES] Error generating top voices report:', error);
      return this.createEmptyReport(startTime, endTime, label);
    }
  }

  /**
   * Get top voices for integration into sentiment reports
   */
  async getTopVoicesForReport(
    startTime: number,
    endTime: number,
    limit: number = 10
  ): Promise<TopVoice[]> {
    const hours = Math.round((endTime - startTime) / (60 * 60 * 1000));
    const report = await this.generateTopVoicesReport(hours, limit);
    return report.topVoices;
  }

  /**
   * Format top voices report for Discord
   */
  formatReportForDiscord(report: TopVoicesReport, limit?: number): string {
    const displayLimit = limit || report.topVoices.length;
    const voices = report.topVoices.slice(0, displayLimit);

    let formatted = `👥 **Top Voices Report - ${report.timeframe.label}**\n\n`;
    formatted += `**Overview:**\n`;
    formatted += `• Total unique authors: **${report.totalUniqueAuthors}**\n`;
    formatted += `• Total mentions: **${report.totalMentions}**\n\n`;

    if (voices.length === 0) {
      formatted += `*No data available for this period*\n`;
      return formatted;
    }

    formatted += `**Top ${voices.length} Voices:**\n`;

    for (let i = 0; i < voices.length; i++) {
      const voice = voices[i];
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;

      const formattedUsername = formatUsernameWithCabal(voice.username, true);
      formatted += `${medal} **${formattedUsername}**`;

      if (voice.name) {
        formatted += ` (${voice.name})`;
      }

      formatted += ` - ${voice.mentionCount} mention${voice.mentionCount !== 1 ? 's' : ''}`;

      if (voice.followerCount) {
        formatted += ` • ${this.formatFollowerCount(voice.followerCount)} followers`;
      }

      if (voice.averageSentiment) {
        const emoji = this.getSentimentEmoji(voice.averageSentiment.score);
        formatted += ` ${emoji}`;
      }

      formatted += '\n';

      // Add sample tweet URLs if available (show up to 2 recent tweets)
      if ((voice as any).sampleTweetUrls && (voice as any).sampleTweetUrls.length > 0) {
        const urlsToShow = (voice as any).sampleTweetUrls.slice(0, 2);
        for (let j = 0; j < urlsToShow.length; j++) {
          formatted += `   └ [Recent Tweet ${j + 1}](${urlsToShow[j]})\n`;
        }
      }
    }

    return formatted;
  }

  /**
   * Format top voices as a simple table
   */
  formatAsTable(report: TopVoicesReport, limit?: number): string {
    const displayLimit = limit || report.topVoices.length;
    const voices = report.topVoices.slice(0, displayLimit);

    if (voices.length === 0) {
      return 'No top voices data available for this period.';
    }

    let table = `Top Voices - ${report.timeframe.label}\n`;
    table += `${'─'.repeat(60)}\n`;
    table += `Rank | Username | Mentions | Followers | Sentiment\n`;
    table += `${'─'.repeat(60)}\n`;

    for (let i = 0; i < voices.length; i++) {
      const voice = voices[i];
      const rank = (i + 1).toString().padEnd(4);
      const formattedUsername = formatUsernameWithCabal(voice.username, false);
      const username = formattedUsername.padEnd(25).substring(0, 25);
      const mentions = voice.mentionCount.toString().padEnd(8);
      const followers = voice.followerCount
        ? this.formatFollowerCount(voice.followerCount).padEnd(10)
        : 'N/A'.padEnd(10);
      const sentiment = voice.averageSentiment
        ? `${voice.averageSentiment.score >= 0 ? '+' : ''}${voice.averageSentiment.score.toFixed(2)}`
        : 'N/A';

      table += `${rank} | ${username} | ${mentions} | ${followers} | ${sentiment}\n`;
    }

    table += `${'─'.repeat(60)}\n`;
    table += `Total: ${report.totalUniqueAuthors} unique authors, ${report.totalMentions} mentions\n`;

    return table;
  }

  /**
   * Helper to create empty report
   */
  private createEmptyReport(startTime: number, endTime: number, label: string): TopVoicesReport {
    return {
      id: v4(),
      timeframe: {
        start: startTime,
        end: endTime,
        label,
      },
      totalUniqueAuthors: 0,
      totalMentions: 0,
      topVoices: [],
      generatedAt: Date.now(),
    };
  }

  /**
   * Helper to format follower count
   */
  private formatFollowerCount(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  }

  /**
   * Helper to get sentiment emoji
   */
  private getSentimentEmoji(score: number): string {
    if (score > 0.5) return '🟢';
    if (score > 0.1) return '🔵';
    if (score > -0.1) return '⚪';
    if (score > -0.5) return '🟡';
    return '🔴';
  }

  /**
   * Helper to get sentiment label
   */
  private getSentimentLabel(score: number): string {
    if (score > 0.5) return 'Very Positive';
    if (score > 0.2) return 'Positive';
    if (score > -0.2) return 'Neutral';
    if (score > -0.5) return 'Negative';
    return 'Very Negative';
  }

  /**
   * Generate a CABAL-only top voices report for a given time period
   */
  async generateCabalTopVoicesReport(hours: number, limit: number = 50): Promise<TopVoicesReport> {
    const endTime = Date.now();
    const startTime = endTime - hours * 60 * 60 * 1000;
    const label =
      hours === 24 ? 'Last 24 hours' : hours === 168 ? 'Last 7 days' : `Last ${hours} hours`;

    logger.info(`[TOP_VOICES_CABAL] Generating CABAL top voices report for ${label}`);

    // Get the full report first
    const fullReport = await this.generateTopVoicesReport(hours, 1000); // Get more voices to filter

    // Filter to only CABAL members
    const cabalVoices = filterCabalMembers(fullReport.topVoices);
    const cabalUsernames = getCabalUsernames();

    // Calculate CABAL-specific stats
    const totalCabalMembers = cabalUsernames.size;
    const activeCabalMembers = cabalVoices.length;
    const totalCabalMentions = cabalVoices.reduce((sum, voice) => sum + voice.mentionCount, 0);

    // Create CABAL-only report
    const cabalReport: TopVoicesReport = {
      ...fullReport,
      topVoices: cabalVoices.slice(0, limit),
      totalUniqueAuthors: activeCabalMembers,
      totalMentions: totalCabalMentions,
    };

    logger.info(
      `[TOP_VOICES_CABAL] Generated CABAL report with ${cabalVoices.length} active members out of ${totalCabalMembers} total CABAL members`
    );

    return cabalReport;
  }

  /**
   * Format CABAL top voices report for Discord
   */
  formatCabalReportForDiscord(report: TopVoicesReport, limit?: number): string {
    const displayLimit = limit || report.topVoices.length;
    const voices = report.topVoices.slice(0, displayLimit);
    const cabalUsernames = getCabalUsernames();

    let formatted = `👥 **CABAL Top Voices Report - ${report.timeframe.label}**\n\n`;
    formatted += `**CABAL Overview:**\n`;
    formatted += `• Total CABAL members: **${cabalUsernames.size}**\n`;
    formatted += `• Active CABAL members: **${report.totalUniqueAuthors}**\n`;
    formatted += `• Total mentions from CABAL: **${report.totalMentions}**\n\n`;

    if (voices.length === 0) {
      formatted += `*No CABAL members were active during this period*\n`;
      return formatted;
    }

    formatted += `**CABAL Rankings:**\n`;

    for (let i = 0; i < voices.length; i++) {
      const voice = voices[i];
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;

      // CABAL members always get stars in CABAL-only reports
      formatted += `${medal} ⭐ **@${voice.username}** ⭐`;

      if (voice.name) {
        formatted += ` (${voice.name})`;
      }

      formatted += ` - ${voice.mentionCount} mention${voice.mentionCount !== 1 ? 's' : ''}`;

      if (voice.followerCount) {
        formatted += ` • ${this.formatFollowerCount(voice.followerCount)} followers`;
      }

      if (voice.averageSentiment) {
        const emoji = this.getSentimentEmoji(voice.averageSentiment.score);
        formatted += ` ${emoji}`;
      }

      formatted += '\n';

      // Add sample tweet URLs if available (show up to 2 recent tweets)
      if ((voice as any).sampleTweetUrls && (voice as any).sampleTweetUrls.length > 0) {
        const urlsToShow = (voice as any).sampleTweetUrls.slice(0, 2);
        for (let j = 0; j < urlsToShow.length; j++) {
          formatted += `   └ [Recent Tweet ${j + 1}](${urlsToShow[j]})\n`;
        }
      }
    }

    return formatted;
  }
}
