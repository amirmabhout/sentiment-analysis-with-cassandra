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

/**
 * Action for generating daily top voices report (last 24 hours)
 */
export const topVoicesDailyAction: Action = {
  name: 'TOP_VOICES_DAILY',
  similes: ['DAILY_TOP_VOICES', 'TOP_MENTIONS_TODAY', 'DAILY_INFLUENCERS'],
  description: 'Generate a report of top voices (most mentioned authors) from the last 24 hours',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    logger.debug('[TopVoicesDaily] Validating top voices daily action');

    const text = message.content.text?.toLowerCase() || '';

    // Check for top voices related keywords
    const topVoicesKeywords = [
      'top voices',
      'top mentions',
      'most mentioned',
      'influencers',
      'top authors',
      'top users',
      'top accounts',
      'leaderboard',
      'who is talking',
      'who mentioned'
    ];

    const hasTopVoicesKeyword = topVoicesKeywords.some((keyword) => text.includes(keyword));

    // Check for daily/24h keywords
    const dailyKeywords = [
      'daily',
      'today',
      '24 hour',
      '24h',
      'last day',
      'past day',
      'yesterday'
    ];

    const hasDailyKeyword = dailyKeywords.some((keyword) => text.includes(keyword));

    // Valid if has top voices keyword and daily keyword, or just "top voices" without a time qualifier
    const isValid = hasTopVoicesKeyword && (hasDailyKeyword || !text.includes('week'));

    if (isValid) {
      logger.info('[TopVoicesDaily] Top voices daily action validated');
    } else {
      logger.debug('[TopVoicesDaily] Message does not match top voices daily criteria');
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
    logger.info('[TopVoicesDaily] Generating daily top voices report');

    try {
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
      let limit = 100; // Default to top 100 for actions

      // Check if user specified a different limit
      const limitMatch = text.match(/top\s+(\d+)/);
      if (limitMatch) {
        limit = Math.min(parseInt(limitMatch[1], 10), 100);
      }

      logger.info(`[TopVoicesDaily] Generating report for top ${limit} voices from last 24 hours`);

      // Generate the report
      const report = await topVoicesService.generateTopVoicesReport(24, limit);

      // Format the report based on the context
      let formattedReport: string;
      
      // Use Discord formatting if available, otherwise use table format
      if (callback) {
        formattedReport = topVoicesService.formatReportForDiscord(report, limit);
      } else {
        formattedReport = topVoicesService.formatAsTable(report, limit);
      }

      // Send the report
      if (callback) {
        await callback({
          text: formattedReport,
          action: 'TOP_VOICES_DAILY',
        });
      }

      logger.info(
        `[TopVoicesDaily] Successfully generated daily top voices report with ${report.topVoices.length} voices`
      );

      return {
        success: true,
        text: 'Daily top voices report generated successfully',
        values: {
          reportGenerated: true,
          totalUniqueAuthors: report.totalUniqueAuthors,
          totalMentions: report.totalMentions,
          topVoicesCount: report.topVoices.length,
          timeframe: '24 hours',
        },
        data: {
          actionName: 'TOP_VOICES_DAILY',
          report,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('[TopVoicesDaily] Error generating daily top voices report:', error);

      const errorMsg =
        'I encountered an error while generating the daily top voices report. Please try again.';
      if (callback) {
        await callback({
          text: errorMsg,
          error: true,
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error || 'Unknown error')),
        text: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Show me the top voices from today',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **Top Voices Report - Last 24 hours**\n\n**Overview:**\n• Total unique authors: **156**\n• Total mentions: **423**\n\n**Top 10 Voices:**\n🥇 **@ai16z_intern** (AI16Z Intern) - 45 mentions • 125.3K followers 🟢\n🥈 **@shawmakesmagic** (Shaw) - 38 mentions • 89.2K followers 🔵\n🥉 **@DegenSpartan** (DΞgen Spartan) - 31 mentions • 67.8K followers 🟢\n4. **@pmairca** (pmarca) - 28 mentions • 234.5K followers ⚪\n5. **@cryptohayes** (Arthur Hayes) - 24 mentions • 198.7K followers 🔵',
          actions: ['TOP_VOICES_DAILY'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Who are the top 20 daily mentions?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **Top Voices Report - Last 24 hours**\n\n**Overview:**\n• Total unique authors: **312**\n• Total mentions: **867**\n\n[Shows top 20 voices with their mention counts, follower counts, and sentiment indicators]',
          actions: ['TOP_VOICES_DAILY'],
        },
      },
    ],
  ],
};