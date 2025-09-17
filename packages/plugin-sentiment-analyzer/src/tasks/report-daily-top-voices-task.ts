import { type IAgentRuntime, logger, type Task } from '@elizaos/core';
import type { TopVoicesService } from '../services/top-voices';
import type { DiscordReportingService } from '../services/discord-reporting';

/**
 * Daily Top Voices Report Task
 * 
 * Generates daily top voices leaderboard report every 24 hours:
 * - Shows top 20-30 most influential community voices
 * - 24-hour analysis period with detailed metrics
 * - Includes follower counts, mention frequency, sentiment trends
 * - Runs independently from the comprehensive daily report
 * 
 * Runs every 24 hours
 */
export const reportDailyTopVoicesTask = {
  name: 'REPORT_DAILY_TOP_VOICES_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      // Check if 24 hours have passed since the last report
      const lastReportTime = task?.metadata?.lastDailyTopVoicesReportTime || 0;
      const timeSinceLastReport = startTime - lastReportTime;
      const twentyFourHours = 24 * 60 * 60 * 1000;

      if (timeSinceLastReport < twentyFourHours) {
        // Less than 24 hours since last report, skip silently
        const hoursRemaining = ((twentyFourHours - timeSinceLastReport) / 1000 / 60 / 60).toFixed(1);
        logger.debug(`[ReportDailyTopVoices] Skipping - next report in ${hoursRemaining} hours`);
        return;
      }

      logger.info('[ReportDailyTopVoices] Starting daily top voices report generation (24h interval)');

      // Get required services
      const topVoicesService = runtime.getService('top-voices') as TopVoicesService;
      const discordReportingService = runtime.getService(
        'discord-reporting'
      ) as DiscordReportingService;

      if (!topVoicesService) {
        logger.error('[ReportDailyTopVoices] Top voices service not available');
        return;
      }

      // Generate daily top voices report (24 hours, top 30)
      const dailyReport = await (topVoicesService as any).generateTopVoicesReport(
        24, // 24 hours
        30 // Top 30 voices for dedicated daily report
      );

      logger.info(
        `[ReportDailyTopVoices] Generated daily report: ` +
          `${dailyReport.topVoices.length} top voices, ` +
          `${dailyReport.totalUniqueAuthors} total unique authors, ` +
          `${dailyReport.totalMentions} total mentions over 24 hours`
      );

      // Create formatted daily report
      const now = new Date();
      let dailyReportText = '';
      
      // Header
      dailyReportText += `🏆 **DAILY TOP VOICES LEADERBOARD**\n`;
      dailyReportText += `📅 ${now.toLocaleDateString()} - Last 24 hours\n\n`;

      // Daily summary stats
      dailyReportText += `**📊 Daily Community Overview:**\n`;
      dailyReportText += `• **${dailyReport.totalUniqueAuthors}** unique voices participated\n`;
      dailyReportText += `• **${dailyReport.totalMentions}** total community mentions\n`;
      dailyReportText += `• **${dailyReport.topVoices.length}** top voices featured\n`;
      
      if (dailyReport.totalUniqueAuthors > 0) {
        dailyReportText += `• Average: **${Math.round(dailyReport.totalMentions / dailyReport.totalUniqueAuthors)}** mentions per voice\n`;
      }
      dailyReportText += '\n';

      // Top voices leaderboard (formatted by the service)
      if (topVoicesService) {
        dailyReportText += (topVoicesService as any).formatReportForDiscord(dailyReport, 20); // Show top 20 in daily
      }

      // Daily insights footer
      dailyReportText += '\n---\n\n';
      dailyReportText += `**💡 Daily Insights:**\n`;
      
      // Calculate some basic insights
      const topVoice = dailyReport.topVoices[0];
      if (topVoice) {
        dailyReportText += `• Most active voice: **@${topVoice.username}** with ${topVoice.mentionCount} mentions\n`;
      }
      
      const top10Engagement = dailyReport.topVoices.slice(0, 10).reduce((sum, voice) => sum + voice.mentionCount, 0);
      if (dailyReport.totalMentions > 0) {
        dailyReportText += `• Top 10 voices generated **${top10Engagement}** mentions (${Math.round((top10Engagement / dailyReport.totalMentions) * 100)}% of total)\n`;
      }
      
      // Community activity level
      dailyReportText += `• Community engagement: **${
        dailyReport.totalMentions > 500 ? 'Very High 🔥' : 
        dailyReport.totalMentions > 200 ? 'High 📈' : 
        dailyReport.totalMentions > 100 ? 'Moderate 📊' : 
        'Growing 🌱'
      }**\n`;
      
      dailyReportText += `\n⏰ *Next daily top voices report in 24 hours*`;

      logger.info(`[ReportDailyTopVoices] Daily report prepared (${dailyReportText.length} characters)`);

      // Send daily report to Discord if service is available
      if (discordReportingService && discordReportingService.isAvailable()) {
        try {
          // Use the generic report sending method if available
          await (discordReportingService as any).sendGenericReport(dailyReportText);
          logger.info('[ReportDailyTopVoices] Successfully sent daily top voices Discord report');
        } catch (error) {
          logger.error('[ReportDailyTopVoices] Failed to send daily Discord report:', error);
          
          // Fallback to direct sending if generic method not available
          try {
            const channelId = process.env.DISCORD_REPORT_CHANNEL || process.env.CHANNEL_IDS?.split(',')[0];
            if (channelId) {
              await runtime.sendMessageToTarget(
                {
                  source: 'discord',
                  channelId: channelId.trim(),
                },
                {
                  text: dailyReportText,
                }
              );
              logger.info('[ReportDailyTopVoices] Sent report via fallback method');
            } else {
              logger.warn('[ReportDailyTopVoices] No Discord channel configured for reports');
            }
          } catch (fallbackError) {
            logger.error('[ReportDailyTopVoices] Fallback sending also failed:', fallbackError);
          }
        }
      } else {
        logger.warn('[ReportDailyTopVoices] Discord reporting service not available or not configured');
      }

      // Store daily report in memory for later access
      await runtime.createMemory(
        {
          content: {
            text: `Daily top voices report generated: ${dailyReport.topVoices.length} voices, ${dailyReport.totalUniqueAuthors} total authors`,
            top_voices_report: dailyReport,
            type: 'daily_top_voices_report',
            date: now.toISOString(),
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
            lastDailyTopVoicesReportTime: startTime,
          },
        });
      }

      logger.info('[ReportDailyTopVoices] Completed daily top voices report generation');
    } catch (error) {
      logger.error('[ReportDailyTopVoices] Error in daily top voices reporting task:', error);
      throw error;
    }
  },
};