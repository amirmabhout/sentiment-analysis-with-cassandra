import { type IAgentRuntime, logger, type Task } from '@elizaos/core';
import type { ReportGenerationService } from '../services/report-generation';
import type { DiscordReportingService } from '../services/discord-reporting';

/**
 * 6-Hour Sentiment Report Task
 * 
 * Generates detailed sentiment reports every 6 hours:
 * - Analyzes sentiment trends over the last 6 hours
 * - Includes top positive/negative posts
 * - Shows category breakdowns (trading vs ecosystem)
 * - Sends formatted reports to Discord channels
 * 
 * Runs every 6 hours automatically
 */
export const report6hTask = {
  name: 'SENTIMENT_REPORT_6H_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      // Check if enough time has passed since last report (6 hours)
      const reportInterval = 6 * 60 * 60 * 1000; // 6 hours
      const lastReportTime = task?.metadata?.lastReportTime || 0;
      const timeSinceLastReport = startTime - lastReportTime;

      if (timeSinceLastReport < reportInterval) {
        // Too early to run, skip silently
        return;
      }

      logger.info('[Report6h] Starting 6-hour sentiment report generation');

      // Get required services
      const sentimentService = runtime.getService('sentiment-analysis');
      const reportGenerationService = runtime.getService(
        'report-generation'
      ) as ReportGenerationService;
      const discordReportingService = runtime.getService(
        'discord-reporting'
      ) as DiscordReportingService;

      if (!sentimentService || !reportGenerationService) {
        logger.error('[Report6h] Required services not available');
        return;
      }

      // Generate detailed report for the last 6 hours using unified service
      const watchTerms = (sentimentService as any).getWatchTerms();
      const detailedReport = await reportGenerationService.generateReport(
        watchTerms,
        6, // Last 6 hours
        'detailed'
      );

      // Get top sentiment tweets for the same 6-hour period
      const topTweets = await reportGenerationService.getTopSentimentTweets(6);

      logger.info(
        `[Report6h] Generated report: ` +
          `${detailedReport.overallMetrics.totalVolume} posts, ` +
          `${detailedReport.breakdowns.length} watch term breakdowns, ` +
          `${detailedReport.alerts.length} alerts, ` +
          `${topTweets.positiveTweets.length} top positive tweets, ` +
          `${topTweets.negativeTweets.length} top negative tweets`
      );

      // Send detailed report with top tweets to Discord if service is available
      if (discordReportingService && discordReportingService.isAvailable()) {
        try {
          await discordReportingService.sendDetailedSentimentReport(detailedReport, topTweets);
          logger.info('[Report6h] Successfully sent Discord report with top tweets');
        } catch (error) {
          logger.error('[Report6h] Failed to send Discord report:', error);
        }
      } else {
        logger.warn('[Report6h] Discord reporting service not available or not configured');
      }

      // Store report in memory for later access
      await runtime.createMemory(
        {
          content: {
            text: `6-hour sentiment report generated: ${detailedReport.overallMetrics.totalVolume} posts analyzed`,
            sentiment_report: detailedReport,
            type: 'sentiment_report_6h',
          },
          roomId: runtime.agentId, // Store in agent's own room
          entityId: runtime.agentId,
          agentId: runtime.agentId,
        },
        'messages'
      );

      // Update task metadata with last report time
      if (task?.id) {
        await runtime.updateTask(task.id, {
          metadata: {
            ...task.metadata,
            lastReportTime: startTime,
          },
        });
      }

      logger.info('[Report6h] Completed 6-hour sentiment report generation');
    } catch (error) {
      logger.error('[Report6h] Error in 6-hour sentiment reporting task:', error);
      throw error;
    }
  },
};