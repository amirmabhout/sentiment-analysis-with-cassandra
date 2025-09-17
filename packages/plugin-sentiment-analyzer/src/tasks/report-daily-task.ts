import { type IAgentRuntime, logger, type Task } from '@elizaos/core';
import type { ReportGenerationService } from '../services/report-generation';
import type { DiscordReportingService } from '../services/discord-reporting';
import type { TopVoicesService } from '../services/top-voices';

/**
 * Daily Comprehensive Report Task
 * 
 * Generates comprehensive daily reports at midnight (00:00-01:00):
 * - 24-hour sentiment analysis with full breakdowns
 * - Daily top voices leaderboard (top influencers)
 * - Combined into single comprehensive daily report
 * - Sent to Discord with full analytics
 * 
 * Runs once per day at midnight
 */
export const reportDailyTask = {
  name: 'SENTIMENT_REPORT_DAILY_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      // Check if 24 hours have passed since the last report
      const now = new Date();
      const lastReportTime = task?.metadata?.lastDailyReportTime || 0;
      const timeSinceLastReport = startTime - lastReportTime;
      const twentyFourHours = 24 * 60 * 60 * 1000;

      if (timeSinceLastReport < twentyFourHours) {
        // Less than 24 hours since last report, skip silently
        const hoursRemaining = ((twentyFourHours - timeSinceLastReport) / 1000 / 60 / 60).toFixed(1);
        logger.debug(`[ReportDaily] Skipping - next report in ${hoursRemaining} hours`);
        return;
      }

      logger.info('[ReportDaily] Starting comprehensive daily report generation (24h interval)');

      // Get required services
      const sentimentService = runtime.getService('sentiment-analysis');
      const reportGenerationService = runtime.getService(
        'report-generation'
      ) as ReportGenerationService;
      const topVoicesService = runtime.getService('top-voices') as TopVoicesService;
      const discordReportingService = runtime.getService(
        'discord-reporting'
      ) as DiscordReportingService;

      if (!sentimentService || !reportGenerationService) {
        logger.error('[ReportDaily] Required services not available');
        return;
      }

      // Generate comprehensive daily sentiment report (24 hours)
      const watchTerms = (sentimentService as any).getWatchTerms();
      const dailyReport = await reportGenerationService.generateReport(
        watchTerms,
        24, // Last 24 hours
        'detailed'
      );

      // Get top sentiment tweets for the same 24-hour period
      const topTweets = await reportGenerationService.getTopSentimentTweets(24);

      logger.info(
        `[ReportDaily] Generated daily sentiment report: ` +
          `${dailyReport.overallMetrics.totalVolume} posts, ` +
          `${dailyReport.breakdowns.length} watch term breakdowns, ` +
          `${dailyReport.alerts.length} alerts`
      );

      // Generate daily top voices report if service is available
      let topVoicesReport = null;
      if (topVoicesService) {
        try {
          topVoicesReport = await (topVoicesService as any).generateTopVoicesReport(24, 20); // Top 20 for daily
          logger.info(
            `[ReportDaily] Generated daily top voices: ${topVoicesReport.topVoices.length} voices, ` +
              `${topVoicesReport.totalUniqueAuthors} total authors`
          );
        } catch (error) {
          logger.warn('[ReportDaily] Failed to generate top voices report:', error);
        }
      }

      // Create comprehensive daily report by combining both reports
      let comprehensiveReport = '';

      // 1. Sentiment Report Section
      if (reportGenerationService) {
        comprehensiveReport += reportGenerationService.formatReportForDiscord(dailyReport);
      }

      // 2. Top Voices Section (if available)
      if (topVoicesReport && topVoicesService) {
        comprehensiveReport += '\n\n---\n\n';
        comprehensiveReport += '👥 **DAILY TOP VOICES LEADERBOARD**\n\n';
        comprehensiveReport += (topVoicesService as any).formatReportForDiscord(topVoicesReport, 15); // Show top 15 in daily report
      }

      // 3. Daily Summary Footer
      comprehensiveReport += '\n\n---\n\n';
      comprehensiveReport += `📅 **Daily Summary for ${now.toLocaleDateString()}**\n`;
      comprehensiveReport += `• Sentiment posts analyzed: **${dailyReport.overallMetrics.totalVolume}**\n`;
      if (topVoicesReport) {
        comprehensiveReport += `• Active community voices: **${topVoicesReport.totalUniqueAuthors}**\n`;
        comprehensiveReport += `• Total community mentions: **${topVoicesReport.totalMentions}**\n`;
      }
      comprehensiveReport += `• Report generated: **${now.toLocaleString()}**\n`;

      logger.info(`[ReportDaily] Comprehensive daily report prepared (${comprehensiveReport.length} characters)`);

      // Send comprehensive daily report to Discord if service is available
      if (discordReportingService && discordReportingService.isAvailable()) {
        try {
          // Split the report if it's too long for Discord (2000 char limit per message)
          const maxLength = 1800; // Leave some margin
          if (comprehensiveReport.length > maxLength) {
            // Send sentiment report first
            await discordReportingService.sendDetailedSentimentReport(dailyReport, topTweets);
            
            // Then send top voices report separately if available
            if (topVoicesReport && topVoicesService) {
              const topVoicesFormatted = (topVoicesService as any).formatReportForDiscord(topVoicesReport, 15);
              await runtime.sendMessageToTarget(
                {
                  source: 'discord',
                  channelId: process.env.DISCORD_REPORT_CHANNEL,
                },
                {
                  text: topVoicesFormatted,
                }
              );
            }
          } else {
            // Send as single comprehensive report
            await runtime.sendMessageToTarget(
              {
                source: 'discord',
                channelId: process.env.DISCORD_REPORT_CHANNEL,
              },
              {
                text: comprehensiveReport,
              }
            );
          }
          
          logger.info('[ReportDaily] Successfully sent comprehensive daily Discord report');
        } catch (error) {
          logger.error('[ReportDaily] Failed to send daily Discord report:', error);
        }
      } else {
        logger.warn('[ReportDaily] Discord reporting service not available or not configured');
      }

      // Store daily report in memory for later access
      await runtime.createMemory(
        {
          content: {
            text: `Daily comprehensive report generated: ${dailyReport.overallMetrics.totalVolume} posts analyzed, ${topVoicesReport?.totalUniqueAuthors || 0} voices tracked`,
            sentiment_report: dailyReport,
            top_voices_report: topVoicesReport,
            type: 'daily_comprehensive_report',
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
            lastDailyReportTime: startTime,
          },
        });
      }

      logger.info('[ReportDaily] Completed comprehensive daily report generation');
    } catch (error) {
      logger.error('[ReportDaily] Error in daily comprehensive reporting task:', error);
      throw error;
    }
  },
};