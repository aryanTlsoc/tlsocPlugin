/**
 * Security alert query builders.
 * Pure functions returning Elasticsearch query bodies.
 */

import type { estypes } from '@elastic/elasticsearch';

export interface TimeRangeParams {
  index: string;
  from: string;
  to: string;
}

const buildBaseTimeFilter = (params: TimeRangeParams): estypes.QueryDslQueryContainer => ({
  range: {
    '@timestamp': {
      gte: params.from,
      lte: params.to,
      format: 'strict_date_optional_time',
    },
  },
});

/**
 * Builds query for aggregating alerts over time.
 */
export const buildAlertsOverTimeQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 0,
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    alerts_over_time: {
      date_histogram: {
        field: '@timestamp',
        fixed_interval: '1h',
        min_doc_count: 0,
        extended_bounds: {
          min: params.from,
          max: params.to,
        },
      },
    },
  },
});

/**
 * Builds query for aggregating alerts by severity.
 */
export const buildAlertsBySeverityQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 0,
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    by_severity: {
      terms: {
        field: 'kibana.alert.severity',
        size: 4,
        order: { _count: 'desc' },
      },
    },
  },
});

/**
 * Builds query for top alert rules.
 */
export const buildTopRulesQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 0,
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    top_rules: {
      terms: {
        field: 'kibana.alert.rule.name',
        size: 10,
        order: { _count: 'desc' },
      },
    },
  },
});

/**
 * Builds query for top users triggering alerts.
 */
export const buildTopUsersQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 0,
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    top_users: {
      terms: {
        field: 'user.name',
        size: 10,
        order: { _count: 'desc' },
      },
    },
  },
});

/**
 * Builds query for MITRE tactic breakdown.
 */
export const buildMitreTacticsQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 0,
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    mitre_tactics: {
      terms: {
        field: 'kibana.alert.rule.threat.tactic.name',
        size: 15,
        order: { _count: 'desc' },
      },
    },
  },
});

/**
 * Builds query to get recent high-risk active alerts.
 */
export const buildRecentHighRiskQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 20,
  _source: [
    '@timestamp',
    'kibana.alert.severity',
    'risk_score',
    'kibana.alert.status',
    'kibana.alert.workflow_status',
    'kibana.alert.rule.name',
    'kibana.alert.rule.uuid',
    'user.name',
    'user.target.name',
    'observer.server',
    'observer.department',
    'service.name',
    'kibana.alert.rule.threat.tactic',
    'kibana.alert.rule.threat.technique',
    'event.action',
    'kibana.alert.uuid',
  ],
  query: {
    bool: {
      filter: [
        buildBaseTimeFilter(params),
        { range: { risk_score: { gte: 70 } } },
        { term: { 'kibana.alert.status': 'active' } },
      ],
    },
  },
  sort: [{ '@timestamp': { order: 'desc' } }],
});

/**
 * Builds query for summary count metrics.
 */
export const buildSummaryCountsQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 0,
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    total_alerts: {
      value_count: {
        field: 'kibana.alert.uuid',
      },
    },
    total_open: {
      filter: {
        term: {
          'kibana.alert.workflow_status': 'open',
        },
      },
    },
    high_critical: {
      filter: {
        bool: {
          should: [
            { term: { 'kibana.alert.severity': 'high' } },
            { term: { 'kibana.alert.severity': 'critical' } },
          ],
          minimum_should_match: 1,
        },
      },
    },
  },
});
