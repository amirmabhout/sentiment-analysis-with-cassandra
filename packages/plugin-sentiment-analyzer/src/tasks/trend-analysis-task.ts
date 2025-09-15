import { type IAgentRuntime, logger, type Task } from '@elizaos/core';
import type { ReportGenerationService } from '../services/report-generation';
import type { DiscordReportingService } from '../services/discord-reporting';

/**
 * Trend Analysis Task
 * 
 * Performs weekly sentiment trend analysis and pattern detection:
 * - Analyzes 7-day sentiment patterns and narrative evolution
 * - Identifies emerging trends and shifts in community sentiment
 * - Detects volume changes and engagement patterns
 * - Generates insights for strategic understanding
 * - Sends comprehensive weekly trend reports to Discord
 * 
 * Runs every Sunday for weekly trend reporting
 */
export const trendAnalysisTask = {
  name: 'SENTIMENT_TREND_ANALYSIS_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      const now = new Date();
      const lastTrendTime = task?.metadata?.lastTrendTime || 0;
      const lastTrendDate = new Date(lastTrendTime);

      // Check if today is Sunday (day 0)
      const isSunday = now.getDay() === 0;

      // Check if we haven't run this week yet
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay()); // Start of this week (Sunday)
      thisWeekStart.setHours(0, 0, 0, 0);
      
      const lastTrendThisWeek = lastTrendDate >= thisWeekStart;

      if (!isSunday || lastTrendThisWeek) {
        // Not Sunday or already ran this week, skip silently
        return;
      }

      logger.info('[TrendAnalysis] Starting weekly sentiment trend analysis on Sunday');

      // Get required services
      const sentimentService = runtime.getService('sentiment-analysis');
      const reportGenerationService = runtime.getService(
        'report-generation'
      ) as ReportGenerationService;
      const discordReportingService = runtime.getService(
        'discord-reporting'
      ) as DiscordReportingService;

      if (!sentimentService || !reportGenerationService) {
        logger.error('[TrendAnalysis] Required services not available');
        return;
      }

      // Generate weekly trend report using unified service
      const watchTerms = (sentimentService as any).getWatchTerms();
      const weeklyReport = await reportGenerationService.generateReport(
        watchTerms,
        168, // Last 7 days (168 hours)
        'detailed'
      );

      logger.info(
        `[TrendAnalysis] Generated weekly trend analysis: ` +
          `${weeklyReport.overallMetrics.totalVolume} posts over 7 days, ` +
          `${weeklyReport.breakdowns.length} watch terms analyzed`
      );

      // Generate comprehensive trend insights
      const insights = generateTrendInsights(weeklyReport);

      logger.info(
        `[TrendAnalysis] Generated insights: ` +
          `sentiment trend ${insights.sentimentTrend}, ` +
          `volume trend ${insights.volumeTrend}, ` +
          `${insights.dominantNarratives.length} key narratives, ` +
          `${insights.alertSummary.total} alerts (${insights.alertSummary.highSeverity} high severity)`
      );

      // Create comprehensive weekly trend report for Discord
      let weeklyTrendReport = '';
      
      // Header with week info
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      const weekEnd = new Date(now);
      
      weeklyTrendReport += `📈 **WEEKLY SENTIMENT TREND ANALYSIS**\n`;
      weeklyTrendReport += `📅 Week of ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}\n\n`;

      // Executive Summary
      weeklyTrendReport += `**🎯 Executive Summary:**\n`;
      weeklyTrendReport += `• **Overall Sentiment:** ${insights.sentimentTrend} (${insights.weeklyMetrics.sentimentLabel})\n`;
      weeklyTrendReport += `• **Volume Trend:** ${insights.volumeTrend} (${insights.weeklyMetrics.totalPosts} total posts)\n`;
      weeklyTrendReport += `• **Community Health:** ${insights.engagementMomentum}\n`;
      weeklyTrendReport += `• **Risk Level:** ${insights.strategicInsights.riskLevel}\n\n`;

      // Key Metrics
      weeklyTrendReport += `**📊 Weekly Metrics:**\n`;
      weeklyTrendReport += `• Total Posts: **${insights.weeklyMetrics.totalPosts}** (avg ${insights.weeklyMetrics.averageDailyPosts}/day)\n`;
      weeklyTrendReport += `• Sentiment Score: **${insights.weeklyMetrics.sentimentScore.toFixed(3)}**\n`;
      if (insights.categoryInsights.trading.volume > 0 || insights.categoryInsights.ecosystem.volume > 0) {
        weeklyTrendReport += `• Trading Focus: **${insights.strategicInsights.contentMix.tradingFocus}**\n`;
        weeklyTrendReport += `• Ecosystem Focus: **${insights.strategicInsights.contentMix.ecosystemFocus}**\n`;
      }
      weeklyTrendReport += `\n`;

      // Dominant Narratives
      if (insights.dominantNarratives && insights.dominantNarratives.length > 0) {
        weeklyTrendReport += `**💬 Dominant Narratives:**\n`;
        insights.dominantNarratives.slice(0, 5).forEach((narrative, index) => {
          weeklyTrendReport += `${index + 1}. ${narrative}\n`;
        });
        weeklyTrendReport += `\n`;
      }

      // Key Entities/Topics  
      if (insights.keyEntities && insights.keyEntities.length > 0) {
        weeklyTrendReport += `**🔍 Key Topics & Entities:**\n`;
        weeklyTrendReport += `${insights.keyEntities.slice(0, 5).join(', ')}\n\n`;
      }

      // Alert Summary
      if (insights.alertSummary.total > 0) {
        weeklyTrendReport += `**🚨 Alert Summary:**\n`;
        weeklyTrendReport += `• Total Alerts: **${insights.alertSummary.total}**\n`;
        if (insights.alertSummary.highSeverity > 0) {
          weeklyTrendReport += `• High Severity: **${insights.alertSummary.highSeverity}** ⚠️\n`;
        }
        if (insights.alertSummary.mediumSeverity > 0) {
          weeklyTrendReport += `• Medium Severity: **${insights.alertSummary.mediumSeverity}**\n`;
        }
        if (insights.alertSummary.lowSeverity > 0) {
          weeklyTrendReport += `• Low Severity: **${insights.alertSummary.lowSeverity}**\n`;
        }
        weeklyTrendReport += `\n`;
      }

      // Strategic Insights Footer
      weeklyTrendReport += `**💡 Strategic Insights:**\n`;
      weeklyTrendReport += `• **Trend Direction:** ${insights.strategicInsights.trendDirection}\n`;
      weeklyTrendReport += `• **Community Health:** ${insights.strategicInsights.communityHealth}\n`;
      if (insights.strategicInsights.riskLevel !== 'low') {
        weeklyTrendReport += `• **Risk Assessment:** ${insights.strategicInsights.riskLevel} risk detected\n`;
      }
      
      weeklyTrendReport += `\n📅 *Next trend analysis: ${new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}*`;

      logger.info(`[TrendAnalysis] Weekly trend report prepared (${weeklyTrendReport.length} characters)`);

      // Send weekly trend report to Discord if service is available
      if (discordReportingService && discordReportingService.isAvailable()) {
        try {
          // Discord has a 2000 character limit, so we might need to split
          const maxLength = 1900; // Leave some margin
          if (weeklyTrendReport.length > maxLength) {
            // Split into multiple messages
            const parts = [];
            let currentPart = '';
            const lines = weeklyTrendReport.split('\n');
            
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
                text: weeklyTrendReport,
              }
            );
          }
          
          logger.info('[TrendAnalysis] Successfully sent weekly trend analysis Discord report');
        } catch (error) {
          logger.error('[TrendAnalysis] Failed to send weekly trend Discord report:', error);
        }
      } else {
        logger.warn('[TrendAnalysis] Discord reporting service not available or not configured');
      }

      // Store comprehensive trend analysis in memory
      await runtime.createMemory(
        {
          content: {
            text: `Weekly sentiment trend analysis: ${insights.sentimentTrend} sentiment, ${insights.volumeTrend} volume, ${insights.dominantNarratives.length} key narratives`,
            sentiment_trends: weeklyReport,
            trend_insights: insights,
            type: 'weekly_trend_analysis',
            analysis_period: '7_days',
            week_start: weekStart.toISOString(),
            week_end: weekEnd.toISOString(),
            generated_at: new Date().toISOString(),
          },
          roomId: runtime.agentId,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
        },
        'messages'
      );

      // Update task metadata with last trend analysis time
      if (task?.id) {
        await runtime.updateTask(task.id, {
          metadata: {
            ...task.metadata,
            lastTrendTime: startTime,
          },
        });
      }

      logger.info('[TrendAnalysis] Completed weekly sentiment trend analysis and Discord reporting');
    } catch (error) {
      logger.error('[TrendAnalysis] Error in trend analysis task:', error);
      throw error;
    }
  },
};

/**
 * Generate comprehensive insights from weekly trend data
 */
function generateTrendInsights(weeklyReport: any): any {
  // Extract dominant narratives and themes
  const dominantNarratives = weeklyReport.narratives ? weeklyReport.narratives.slice(0, 3) : [];

  // Analyze sentiment trend direction
  const sentimentChange = weeklyReport.overallMetrics.sentimentChange || 0;
  const sentimentTrend = 
    sentimentChange > 0.1 ? 'improving' :
    sentimentChange < -0.1 ? 'declining' : 'stable';

  // Analyze volume trend direction  
  const volumeChange = weeklyReport.overallMetrics.volumeChange || 0;
  const volumeTrend =
    volumeChange > 20 ? 'increasing' :
    volumeChange < -20 ? 'decreasing' : 'stable';

  // Extract key entities from all breakdowns
  const keyEntities = weeklyReport.breakdowns
    ? weeklyReport.breakdowns.flatMap((b: any) => b.topEntities ? b.topEntities.slice(0, 2) : [])
    : [];

  // Analyze alert patterns
  const alerts = weeklyReport.alerts || [];
  const alertSummary = {
    total: alerts.length,
    highSeverity: alerts.filter((a: any) => a.severity === 'high').length,
    mediumSeverity: alerts.filter((a: any) => a.severity === 'medium').length,
    lowSeverity: alerts.filter((a: any) => a.severity === 'low').length,
  };

  // Category-specific insights
  const categoryInsights = {
    trading: {
      volume: weeklyReport.categoryMetrics?.trading?.totalVolume || 0,
      sentimentScore: weeklyReport.categoryMetrics?.trading?.averageSentiment?.score || 0,
      themes: weeklyReport.categoryMetrics?.trading?.dominantIndicators || [],
    },
    ecosystem: {
      volume: weeklyReport.categoryMetrics?.technology?.totalVolume || 0,
      sentimentScore: weeklyReport.categoryMetrics?.technology?.averageSentiment?.score || 0,
      themes: weeklyReport.categoryMetrics?.technology?.dominantIndicators || [],
    },
  };

  // Calculate engagement momentum
  const totalVolume = weeklyReport.overallMetrics.totalVolume || 0;
  const avgSentiment = weeklyReport.overallMetrics.averageSentiment?.score || 0;
  
  const engagementMomentum = 
    totalVolume > 1000 && avgSentiment > 0.2 ? 'very_positive' :
    totalVolume > 500 && avgSentiment > 0.1 ? 'positive' :
    totalVolume > 200 && avgSentiment > -0.1 ? 'neutral' :
    totalVolume > 100 && avgSentiment > -0.3 ? 'declining' : 'low';

  // Weekly summary metrics
  const weeklyMetrics = {
    totalPosts: totalVolume,
    averageDailyPosts: Math.round(totalVolume / 7),
    sentimentScore: avgSentiment,
    sentimentLabel: 
      avgSentiment > 0.3 ? 'Very Positive' :
      avgSentiment > 0.1 ? 'Positive' :
      avgSentiment > -0.1 ? 'Neutral' :
      avgSentiment > -0.3 ? 'Negative' : 'Very Negative',
  };

  const insights = {
    // Core trend directions
    sentimentTrend,
    volumeTrend,
    engagementMomentum,
    
    // Content analysis
    dominantNarratives,
    keyEntities: keyEntities.slice(0, 5), // Top 5 entities
    
    // Alert patterns
    alertSummary,
    
    // Category breakdown
    categoryInsights,
    
    // Weekly overview
    weeklyMetrics,
    
    // Strategic insights
    strategicInsights: {
      communityHealth: engagementMomentum,
      contentMix: {
        tradingFocus: (categoryInsights.trading.volume / totalVolume * 100).toFixed(1) + '%',
        ecosystemFocus: (categoryInsights.ecosystem.volume / totalVolume * 100).toFixed(1) + '%',
      },
      trendDirection: `${sentimentTrend} sentiment, ${volumeTrend} volume`,
      riskLevel: alertSummary.highSeverity > 3 ? 'high' : 
                 alertSummary.highSeverity > 1 ? 'medium' : 'low',
    },
    
    // Metadata
    analysisDate: new Date().toISOString(),
    periodCovered: '7_days',
    dataPoints: totalVolume,
  };

  return insights;
}