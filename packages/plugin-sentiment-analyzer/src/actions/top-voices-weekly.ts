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
 * Action for generating weekly top voices report (last 7 days)
 */
export const topVoicesWeeklyAction: Action = {
  name: 'TOP_VOICES_WEEKLY',
  similes: ['WEEKLY_TOP_VOICES', 'TOP_MENTIONS_WEEK', 'WEEKLY_INFLUENCERS'],
  description: 'Generate a report of top voices (most mentioned authors) from the last 7 days',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    logger.debug('[TopVoicesWeekly] Validating top voices weekly action');

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
      'who mentioned',
    ];

    const hasTopVoicesKeyword = topVoicesKeywords.some((keyword) => text.includes(keyword));

    // Check for weekly/7day keywords
    const weeklyKeywords = [
      'weekly',
      'week',
      '7 day',
      '7d',
      'seven day',
      'last week',
      'past week',
      'this week',
    ];

    const hasWeeklyKeyword = weeklyKeywords.some((keyword) => text.includes(keyword));

    const isValid = hasTopVoicesKeyword && hasWeeklyKeyword;

    if (isValid) {
      logger.info('[TopVoicesWeekly] Top voices weekly action validated');
    } else {
      logger.debug('[TopVoicesWeekly] Message does not match top voices weekly criteria');
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
    logger.info('[TopVoicesWeekly] Generating weekly top voices report');

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

      logger.info(`[TopVoicesWeekly] Generating report for top ${limit} voices from last 7 days`);

      // Generate the report (168 hours = 7 days)
      const report = await topVoicesService.generateTopVoicesReport(168, limit);

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
          action: 'TOP_VOICES_WEEKLY',
        });
      }

      logger.info(
        `[TopVoicesWeekly] Successfully generated weekly top voices report with ${report.topVoices.length} voices`
      );

      return {
        success: true,
        text: 'Weekly top voices report generated successfully',
        values: {
          reportGenerated: true,
          totalUniqueAuthors: report.totalUniqueAuthors,
          totalMentions: report.totalMentions,
          topVoicesCount: report.topVoices.length,
          timeframe: '7 days',
        },
        data: {
          actionName: 'TOP_VOICES_WEEKLY',
          report,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('[TopVoicesWeekly] Error generating weekly top voices report:', error);

      const errorMsg =
        'I encountered an error while generating the weekly top voices report. Please try again.';
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
          text: 'Show me the top voices from this week',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **Top Voices Report - Last 7 days**\n\n**Overview:**\n• Total unique authors: **892**\n• Total mentions: **3,247**\n\n**Top 10 Voices:**\n🥇 **@ai16z_intern** (AI16Z Intern) - 287 mentions • 125.3K followers 🟢\n🥈 **@shawmakesmagic** (Shaw) - 234 mentions • 89.2K followers 🔵\n🥉 **@DegenSpartan** (DΞgen Spartan) - 198 mentions • 67.8K followers 🟢\n4. **@pmairca** (pmarca) - 176 mentions • 234.5K followers ⚪\n5. **@cryptohayes** (Arthur Hayes) - 145 mentions • 198.7K followers 🔵',
          actions: ['TOP_VOICES_WEEKLY'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Who are the top 50 weekly mentions?',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '👥 **Top Voices Report - Last 7 days**\n\n**Overview:**\n• Total unique authors: **1,456**\n• Total mentions: **5,892**\n\n[Shows top 50 voices with their mention counts, follower counts, and sentiment indicators]',
          actions: ['TOP_VOICES_WEEKLY'],
        },
      },
    ],
  ],
};
