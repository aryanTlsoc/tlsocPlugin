/**
 * Elasticsearch dashboard client wrapper for TLSOC.
 */
import type { estypes } from '@elastic/elasticsearch';
import type { IScopedClusterClient, Logger } from '@kbn/core/server';
import type {
  AlertsByMitre,
  AlertsByRule,
  AlertsBySeverity,
  AlertsByUser,
  AlertsOverTime,
  DashboardMetrics,
  SecurityAlert,
} from '../../../common/types';
import {
  buildAlertsOverTimeQuery,
  buildAlertsBySeverityQuery,
  buildTopRulesQuery,
  buildTopUsersQuery,
  buildMitreTacticsQuery,
  buildRecentHighRiskQuery,
  buildSummaryCountsQuery,
  TimeRangeParams,
} from '../queries/security_alerts_query';
import {
  parseAlertsOverTime,
  parseAlertsBySeverity,
  parseTopRules,
  parseTopUsers,
  parseMitreTactics,
  parseRecentHighRisk,
  parseSummaryCounts,
} from './response_parsers';

/**
 * Indices used by the dashboard ES client.
 */
export interface DashboardEsClientIndices {
  alertsIndex: string;
}

/**
 * Standard wrapper for ES errors in TLSOC dashboard queries.
 */
export class DashboardEsError extends Error {
  public readonly operationName: string;
  public readonly originalError: unknown;

  constructor(operationName: string, originalError: unknown) {
    super(`Dashboard ES error for ${operationName}: ${(originalError as Error)?.message ?? String(originalError)}`);
    this.name = 'DashboardEsError';
    this.operationName = operationName;
    this.originalError = originalError;
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * Client for TLSOC dashboard ES requests.
 */
export class DashboardEsClient {
  private readonly esClient: IScopedClusterClient;
  private readonly logger: Logger;
  private readonly indices: DashboardEsClientIndices;

  constructor(esClient: IScopedClusterClient, logger: Logger, indices: DashboardEsClientIndices) {
    this.esClient = esClient;
    this.logger = logger;
    this.indices = indices;
  }

  private async runQuery<T>(
    operationName: string,
    query: estypes.SearchRequest,
    parser: (response: estypes.SearchResponse<unknown>) => T
  ): Promise<T> {
    this.logger.debug(`DashboardEsClient.${operationName} query: ${JSON.stringify(query)}`);
    try {
      const response = await this.esClient.asCurrentUser.search(query);
      return parser(response as estypes.SearchResponse<unknown>);
    } catch (error) {
      this.logger.error(`DashboardEsClient.${operationName} failed: ${(error as Error).message}`);
      throw new DashboardEsError(operationName, error);
    }
  }

  /**
   * Returns histogram of alerts over time.
   */
  public async getAlertsOverTime(params: TimeRangeParams): Promise<AlertsOverTime> {
    const query = buildAlertsOverTimeQuery({ ...params, index: this.indices.alertsIndex });
    return this.runQuery('getAlertsOverTime', query, parseAlertsOverTime);
  }

  /**
   * Returns counts by severity.
   */
  public async getAlertsBySeverity(params: TimeRangeParams): Promise<AlertsBySeverity> {
    const query = buildAlertsBySeverityQuery({ ...params, index: this.indices.alertsIndex });
    return this.runQuery('getAlertsBySeverity', query, parseAlertsBySeverity);
  }

  /**
   * Returns top triggered rules.
   */
  public async getTopRules(params: TimeRangeParams): Promise<AlertsByRule> {
    const query = buildTopRulesQuery({ ...params, index: this.indices.alertsIndex });
    return this.runQuery('getTopRules', query, parseTopRules);
  }

  /**
   * Returns top users generating alerts.
   */
  public async getTopUsers(params: TimeRangeParams): Promise<AlertsByUser> {
    const query = buildTopUsersQuery({ ...params, index: this.indices.alertsIndex });
    return this.runQuery('getTopUsers', query, parseTopUsers);
  }

  /**
   * Returns MITRE tactic distribution.
   */
  public async getMitreTactics(params: TimeRangeParams): Promise<AlertsByMitre> {
    const query = buildMitreTacticsQuery({ ...params, index: this.indices.alertsIndex });
    return this.runQuery('getMitreTactics', query, parseMitreTactics);
  }

  /**
   * Returns most recent high-risk active alerts.
   */
  public async getRecentHighRisk(params: TimeRangeParams): Promise<SecurityAlert[]> {
    const query = buildRecentHighRiskQuery({ ...params, index: this.indices.alertsIndex });
    return this.runQuery('getRecentHighRisk', query, parseRecentHighRisk);
  }

  /**
   * Returns summary metrics (open and high/critical counts).
   */
  public async getSummaryCounts(params: TimeRangeParams): Promise<{ total: number; openCount: number; highCriticalCount: number }> {
    const query = buildSummaryCountsQuery({ ...params, index: this.indices.alertsIndex });
    return this.runQuery('getSummaryCounts', query, parseSummaryCounts);
  }

  /**
   * Returns all dashboard metrics in a single combined structure.
   */
  public async getDashboardMetrics(params: TimeRangeParams): Promise<DashboardMetrics> {
    this.logger.debug('DashboardEsClient.getDashboardMetrics starting parallel collection');
    const [alertsOverTime, bySeverity, byRule, byUser, byMitre, recentHighRisk, summary] = await Promise.all([
      this.getAlertsOverTime(params),
      this.getAlertsBySeverity(params),
      this.getTopRules(params),
      this.getTopUsers(params),
      this.getMitreTactics(params),
      this.getRecentHighRisk(params),
      this.getSummaryCounts(params),
    ]);

    return {
      total: summary.total,
      openCount: summary.openCount,
      highCriticalCount: summary.highCriticalCount,
      alertsOverTime,
      bySeverity,
      byRule,
      byUser,
      byMitre,
      recentHighRisk,
    };
  }
}

/**
 * Factory function for DashboardEsClient.
 */
export const createDashboardEsClient = (
  esClient: IScopedClusterClient,
  logger: Logger,
  indices: DashboardEsClientIndices
): DashboardEsClient => {
  return new DashboardEsClient(esClient, logger, indices);
};
