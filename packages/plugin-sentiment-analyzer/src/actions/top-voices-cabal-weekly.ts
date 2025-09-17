import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import type { TopVoicesService } from '../services/top-voices.ts';
import { getCabalUsernames } from '../utils/cabal.ts';

/**
 * Action for generating weekly CABAL top voices report (last 7 days)
 * Shows rankings only among CABAL members
 */
export const topVoicesCabalWeeklyAction: Action = {
  name: 'TOP_VOICES_CABAL_WEEKLY',
  similes: ['CABAL_WEEKLY_TOP_VOICES', 'CABAL_TOP_MENTIONS_WEEK', 'CABAL_WEEKLY_RANKINGS'],
  description: 'Generate a report of top voices among CABAL members from the last 7 days',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    logger.debug('[TopVoicesCabalWeekly] Validating CABAL top voices weekly action');

    const text = message.content.text?.toLowerCase() || '';

    // Check for CABAL keywords
    const cabalKeywords = ['cabal'];
    const hasCabalKeyword = cabalKeywords.some((keyword) => text.includes(keyword));

    // Check for top voices related keywords
    const topVoicesKeywords = [
      'top voices',
      'top mentions',
      'most mentioned',
      'ranking',
      'leaderboard',
      'top members',
      'top cabal',
    ];

    const hasTopVoicesKeyword = topVoicesKeywords.some((keyword) => text.includes(keyword));

    // Check for weekly/7-day keywords
    const weeklyKeywords = [
      'weekly',
      'week',
      '7 day',
      '7-day',
      'seven day',
      'last week',
      'past week',
      'this week',
    ];
    const hasWeeklyKeyword = weeklyKeywords.some((keyword) => text.includes(keyword));

    // Valid if has CABAL keyword and weekly keyword, or CABAL + top voices without daily
    const isValid = hasCabalKeyword && (hasWeeklyKeyword || (hasTopVoicesKeyword && !text.includes('daily') && !text.includes('today')));

    if (isValid) {
      logger.info('[TopVoicesCabalWeekly] CABAL top voices weekly action validated');
    } else {
      logger.debug('[TopVoicesCabalWeekly] Message does not match CABAL top voices weekly criteria');
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
    logger.info('[TopVoicesCabalWeekly] Generating weekly CABAL top voices report');

    try {
      // Check if CABAL is configured
      const cabalUsernames = getCabalUsernames();
      if (cabalUsernames.size === 0) {
        const errorMsg = 'CABAL is not configured. Please set SENTIMENT_X_USERNAMES_CABAL environment variable.';
        if (callback) {
          await callback({
            text: errorMsg,
            error: true,
          });
        }

        return {
          success: false,
          error: new Error('CABAL not configured'),
          text: errorMsg,
        };
      }

      // Get the top voices service
      const topVoicesService = runtime.getService('top-voices') as TopVoicesService;

      if (!topVoicesService) {
        const errorMsg = 'Top voices service is not available at the moment.';
        if (callback) {
          await callback({
            text: errorMsg,
            error: true,
          });
        }

        return {
          success: false,
          error: new Error('Top voices service not available'),
          text: errorMsg,
        };
      }

      // Parse the request to determine how many results to show
      const text = message.content.text?.toLowerCase() || '';
      let limit = 50; // Default to top 50 for CABAL actions

      // Check if user specified a different limit
      const limitMatch = text.match(/top\s+(\d+)/);
      if (limitMatch) {
        limit = Math.min(parseInt(limitMatch[1], 10), 100);
      }

      logger.info(`[TopVoicesCabalWeekly] Generating report for top ${limit} CABAL voices from last 7 days`);

      // Generate the CABAL-only report for 7 days (168 hours)
      const report = await topVoicesService.generateCabalTopVoicesReport(168, limit);

      // Format the report for Discord
      let formattedReport: string;
      if (callback) {
        formattedReport = topVoicesService.formatCabalReportForDiscord(report, limit);
      } else {
        // Fallback to table format if not Discord
        formattedReport = `CABAL Top Voices - Last 7 days\n`;
        formattedReport += `Total CABAL members: ${cabalUsernames.size}\n`;
        formattedReport += `Active CABAL members: ${report.totalUniqueAuthors}\n`;
        formattedReport += `Total mentions: ${report.totalMentions}\n\n`;
        
        if (report.topVoices.length === 0) {
          formattedReport += 'No CABAL members were active during this period\n';
        } else {
          report.topVoices.forEach((voice, i) => {
            formattedReport += `${i + 1}. ⭐ @${voice.username} ⭐ - ${voice.mentionCount} mentions\n`;
          });
        }
      }

      // Send the report
      if (callback) {
        await callback({
          text: formattedReport,
          action: 'TOP_VOICES_CABAL_WEEKLY',
        });
      }

      logger.info(
        `[TopVoicesCabalWeekly] Successfully generated weekly CABAL top voices report with ${report.topVoices.length} active members`
      );

      return {
        success: true,
        text: 'Weekly CABAL top voices report generated successfully',
        values: {
          reportGenerated: true,
          totalCabalMembers: cabalUsernames.size,
          activeCabalMembers: report.totalUniqueAuthors,
          totalMentions: report.totalMentions,
          topVoicesCount: report.topVoices.length,
          timeframe: '7 days',
        },
        data: {
          actionName: 'TOP_VOICES_CABAL_WEEKLY',
          report,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('[TopVoicesCabalWeekly] Error generating weekly CABAL top voices report:', error);

      const errorMsg =
        'I encountered an error while generating the weekly CABAL top voices report. Please try again.';
      if (callback) {
        await callback({
          text: errorMsg,
          error: true,
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error) || 'Unknown error'),
        text: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Show me the CABAL top voices from this week',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **CABAL Top Voices Report - Last 7 days**\n\n**CABAL Overview:**\n• Total CABAL members: **23**\n• Active CABAL members: **18**\n• Total mentions from CABAL: **1,245**\n\n**CABAL Rankings:**\n🥇 ⭐ **@amirmabhout** ⭐ - 187 mentions • 125.3K followers 🟢\n🥈 ⭐ **@DayshiftDegen** ⭐ - 156 mentions • 89.2K followers 🔵\n🥉 ⭐ **@33coded** ⭐ - 143 mentions • 67.8K followers 🟢\n4. ⭐ **@satsbased** ⭐ - 128 mentions • 45.2K followers ⚪\n5. ⭐ **@PeterGibbonsPGP** ⭐ - 112 mentions • 32.1K followers 🔵',
          actions: ['TOP_VOICES_CABAL_WEEKLY'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What are the weekly CABAL rankings?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **CABAL Top Voices Report - Last 7 days**\n\n**CABAL Overview:**\n• Total CABAL members: **23**\n• Active CABAL members: **20**\n• Total mentions from CABAL: **2,087**\n\n**CABAL Rankings:**\n🥇 ⭐ **@ProofOfLoveDao** ⭐ - 234 mentions • 56.7K followers 🟢\n🥈 ⭐ **@ElvisGAN777** ⭐ - 198 mentions • 71.4K followers 🔵\n🥉 ⭐ **@basedphetrus** ⭐ - 176 mentions • 38.2K followers ⚪',
          actions: ['TOP_VOICES_CABAL_WEEKLY'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Show top 10 CABAL members this week',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **CABAL Top Voices Report - Last 7 days**\n\n**CABAL Overview:**\n• Total CABAL members: **23**\n• Active CABAL members: **21**\n• Total mentions from CABAL: **3,421**\n\n[Shows top 10 CABAL members with their mention counts, follower counts, and sentiment indicators]',
          actions: ['TOP_VOICES_CABAL_WEEKLY'],
        },
      },
    ],
  ],
};