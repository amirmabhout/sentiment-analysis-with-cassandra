import { type IAgentRuntime, logger, type Task } from '@elizaos/core';
import type { TopVoicesService } from '../services/top-voices';
import type { DiscordReportingService } from '../services/discord-reporting';

/**
 * Weekly Top Voices Report Task
 * 
 * Generates comprehensive weekly top voices leaderboard every Sunday:
 * - Shows top 50-100 most influential community voices
 * - 7-day analysis period with detailed metrics
 * - Includes follower counts, mention frequency, sentiment trends
 * - Perfect for weekly community highlights and engagement
 * 
 * Runs every Sunday (day 0 of the week)
 */
export const reportWeeklyTopVoicesTask = {
  name: 'REPORT_WEEKLY_TOP_VOICES_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      const now = new Date();
      const lastReportTime = task?.metadata?.lastWeeklyReportTime || 0;
      const lastReportDate = new Date(lastReportTime);

      // Check if today is Sunday (day 0)
      const isSunday = now.getDay() === 0;

      // Check if we haven't run this week yet
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay()); // Start of this week (Sunday)
      thisWeekStart.setHours(0, 0, 0, 0);
      
      const lastReportThisWeek = lastReportDate >= thisWeekStart;

      if (!isSunday || lastReportThisWeek) {
        // Not Sunday or already ran this week, skip silently
        return;
      }

      logger.info('[ReportWeeklyTopVoices] Starting weekly top voices report generation on Sunday');

      // Get required services
      const topVoicesService = runtime.getService('top-voices') as TopVoicesService;
      const discordReportingService = runtime.getService(
        'discord-reporting'
      ) as DiscordReportingService;

      if (!topVoicesService) {
        logger.error('[ReportWeeklyTopVoices] Top voices service not available');
        return;
      }

      // Generate comprehensive weekly top voices report (7 days, top 50)
      const weeklyReport = await (topVoicesService as any).generateTopVoicesReport(
        24 * 7, // 7 days in hours
        50 // Top 50 voices for weekly report
      );

      logger.info(
        `[ReportWeeklyTopVoices] Generated weekly report: ` +
          `${weeklyReport.topVoices.length} top voices, ` +
          `${weeklyReport.totalUniqueAuthors} total unique authors, ` +
          `${weeklyReport.totalMentions} total mentions over 7 days`
      );

      // Create enhanced weekly report with additional context
      let weeklyReportText = '';
      
      // Header with week info
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      const weekEnd = new Date(now);
      
      weeklyReportText += `🏆 **WEEKLY TOP VOICES LEADERBOARD**\n`;
      weeklyReportText += `📅 Week of ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}\n\n`;

      // Weekly summary stats
      weeklyReportText += `**📊 Weekly Community Overview:**\n`;
      weeklyReportText += `• **${weeklyReport.totalUniqueAuthors}** unique voices participated\n`;
      weeklyReportText += `• **${weeklyReport.totalMentions}** total community mentions\n`;
      weeklyReportText += `• **${weeklyReport.topVoices.length}** top voices featured\n`;
      weeklyReportText += `• Average: **${Math.round(weeklyReport.totalMentions / weeklyReport.totalUniqueAuthors)}** mentions per voice\n\n`;

      // Top voices leaderboard (formatted by the service)
      weeklyReportText += (topVoicesService as any).formatReportForDiscord(weeklyReport, 25); // Show top 25 in weekly

      // Weekly insights footer
      weeklyReportText += '\n\n---\n\n';
      weeklyReportText += `🎯 **Weekly Insights:**\n`;
      
      // Calculate some basic insights
      const topVoice = weeklyReport.topVoices[0];
      if (topVoice) {
        weeklyReportText += `• Most active voice: **@${topVoice.username}** with ${topVoice.mentionCount} mentions\n`;
      }
      
      const totalEngagement = weeklyReport.topVoices.reduce((sum, voice) => sum + voice.mentionCount, 0);
      weeklyReportText += `• Top 25 voices generated **${totalEngagement}** mentions (${Math.round((totalEngagement / weeklyReport.totalMentions) * 100)}% of total)\n`;
      
      // Community growth indicator
      weeklyReportText += `• Community engagement: **${weeklyReport.totalMentions > 1000 ? 'Very High' : weeklyReport.totalMentions > 500 ? 'High' : weeklyReport.totalMentions > 200 ? 'Moderate' : 'Growing'}**\n`;
      
      weeklyReportText += `\n🗓️ *Next weekly report: ${new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}*`;

      logger.info(`[ReportWeeklyTopVoices] Weekly report prepared (${weeklyReportText.length} characters)`);

      // Send weekly report to Discord if service is available
      if (discordReportingService && discordReportingService.isAvailable()) {
        try {
          // Discord has a 2000 character limit, so we might need to split
          const maxLength = 1900; // Leave some margin
          if (weeklyReportText.length > maxLength) {
            // Split into multiple messages
            const parts = [];
            let currentPart = '';
            const lines = weeklyReportText.split('\n');
            
            for (const line of lines) {
              if ((currentPart + line + '\n').length > maxLength && currentPart) {
                parts.push(currentPart);
                currentPart = line + '\n';
              } else {
                currentPart += line + '\n';
              }
            }
            if (currentPart) parts.push(currentPart);

            // Send each part
            for (let i = 0; i < parts.length; i++) {
              const partHeader = parts.length > 1 ? `**[Part ${i + 1}/${parts.length}]**\n\n` : '';
              await runtime.sendMessageToTarget(
                {
                  source: 'discord',
                  channelId: process.env.DISCORD_REPORT_CHANNEL,
                },
                {
                  text: partHeader + parts[i],
                }
              );
              
              // Small delay between parts to avoid rate limiting
              if (i < parts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } else {
            // Send as single message
            await runtime.sendMessageToTarget(
              {
                source: 'discord',
                channelId: process.env.DISCORD_REPORT_CHANNEL,
              },
              {
                text: weeklyReportText,
              }
            );
          }
          
          logger.info('[ReportWeeklyTopVoices] Successfully sent weekly top voices Discord report');
        } catch (error) {
          logger.error('[ReportWeeklyTopVoices] Failed to send weekly Discord report:', error);
        }
      } else {
        logger.warn('[ReportWeeklyTopVoices] Discord reporting service not available or not configured');
      }

      // Store weekly report in memory for later access
      await runtime.createMemory(
        {
          content: {
            text: `Weekly top voices report generated: ${weeklyReport.topVoices.length} voices, ${weeklyReport.totalUniqueAuthors} total authors`,
            top_voices_report: weeklyReport,
            type: 'weekly_top_voices_report',
            week_start: weekStart.toISOString(),
            week_end: weekEnd.toISOString(),
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
            lastWeeklyReportTime: startTime,
          },
        });
      }

      logger.info('[ReportWeeklyTopVoices] Completed weekly top voices report generation');
    } catch (error) {
      logger.error('[ReportWeeklyTopVoices] Error in weekly top voices reporting task:', error);
      throw error;
    }
  },
};