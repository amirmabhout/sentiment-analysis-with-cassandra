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
 * Action for generating daily CABAL top voices report (last 24 hours)
 * Shows rankings only among CABAL members
 */
export const topVoicesCabalDailyAction: Action = {
  name: 'TOP_VOICES_CABAL_DAILY',
  similes: ['CABAL_DAILY_TOP_VOICES', 'CABAL_TOP_MENTIONS_TODAY', 'CABAL_DAILY_RANKINGS'],
  description: 'Generate a report of top voices among CABAL members from the last 24 hours',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    logger.debug('[TopVoicesCabalDaily] Validating CABAL top voices daily action');

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

    // Check for daily/24h keywords
    const dailyKeywords = ['daily', 'today', '24 hour', '24h', 'last day', 'past day'];
    const hasDailyKeyword = dailyKeywords.some((keyword) => text.includes(keyword));

    // Valid if has CABAL keyword and either top voices keyword or is asking about daily CABAL
    const isValid = hasCabalKeyword && (hasTopVoicesKeyword || hasDailyKeyword);

    if (isValid) {
      logger.info('[TopVoicesCabalDaily] CABAL top voices daily action validated');
    } else {
      logger.debug('[TopVoicesCabalDaily] Message does not match CABAL top voices daily criteria');
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
    logger.info('[TopVoicesCabalDaily] Generating daily CABAL top voices report');

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

      logger.info(`[TopVoicesCabalDaily] Generating report for top ${limit} CABAL voices from last 24 hours`);

      // Generate the CABAL-only report
      const report = await topVoicesService.generateCabalTopVoicesReport(24, limit);

      // Format the report for Discord
      let formattedReport: string;
      if (callback) {
        formattedReport = topVoicesService.formatCabalReportForDiscord(report, limit);
      } else {
        // Fallback to table format if not Discord
        formattedReport = `CABAL Top Voices - Last 24 hours\n`;
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
          action: 'TOP_VOICES_CABAL_DAILY',
        });
      }

      logger.info(
        `[TopVoicesCabalDaily] Successfully generated daily CABAL top voices report with ${report.topVoices.length} active members`
      );

      return {
        success: true,
        text: 'Daily CABAL top voices report generated successfully',
        values: {
          reportGenerated: true,
          totalCabalMembers: cabalUsernames.size,
          activeCabalMembers: report.totalUniqueAuthors,
          totalMentions: report.totalMentions,
          topVoicesCount: report.topVoices.length,
          timeframe: '24 hours',
        },
        data: {
          actionName: 'TOP_VOICES_CABAL_DAILY',
          report,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('[TopVoicesCabalDaily] Error generating daily CABAL top voices report:', error);

      const errorMsg =
        'I encountered an error while generating the daily CABAL top voices report. Please try again.';
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
          text: 'Show me the CABAL top voices from today',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **CABAL Top Voices Report - Last 24 hours**\n\n**CABAL Overview:**\n• Total CABAL members: **23**\n• Active CABAL members: **15**\n• Total mentions from CABAL: **287**\n\n**CABAL Rankings:**\n🥇 ⭐ **@amirmabhout** ⭐ - 45 mentions • 125.3K followers 🟢\n🥈 ⭐ **@DayshiftDegen** ⭐ - 38 mentions • 89.2K followers 🔵\n🥉 ⭐ **@33coded** ⭐ - 31 mentions • 67.8K followers 🟢\n4. ⭐ **@satsbased** ⭐ - 28 mentions • 45.2K followers ⚪\n5. ⭐ **@PeterGibbonsPGP** ⭐ - 24 mentions • 32.1K followers 🔵',
          actions: ['TOP_VOICES_CABAL_DAILY'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What are the daily CABAL rankings?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **CABAL Top Voices Report - Last 24 hours**\n\n**CABAL Overview:**\n• Total CABAL members: **23**\n• Active CABAL members: **12**\n• Total mentions from CABAL: **198**\n\n**CABAL Rankings:**\n🥇 ⭐ **@ProofOfLoveDao** ⭐ - 34 mentions • 56.7K followers 🟢\n🥈 ⭐ **@Smokin_Dave_007** ⭐ - 28 mentions • 41.3K followers ⚪\n🥉 ⭐ **@cichen1314** ⭐ - 22 mentions • 28.9K followers 🔵',
          actions: ['TOP_VOICES_CABAL_DAILY'],
        },
      },
    ],
  ],
};