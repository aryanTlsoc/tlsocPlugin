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
    },
  },
});

const getAlertsHistogramInterval = (from: string): string => {
  switch (from) {
    case 'now-15m':
      return '1m';
    case 'now-30m':
      return '2m';
    case 'now-1h':
      return '5m';
    case 'now-6h':
      return '10m';
    case 'now-24h':
      return '30m';
    case 'now-1w':
    case 'now-7d':
      return '3h';
    case 'now-2w':
      return '6h';
    case 'now-30d':
      return '12h';
    case 'now-60d':
      return '1d';
    case 'now-90d':
      return '1d';
    default:
      return '1d';
  }
};

const buildSeverityRuntimeMappings = (): Record<string, estypes.MappingRuntimeField> => ({
  severity_normalized: {
    type: 'keyword',
    script: {
      source: `
        if (doc.containsKey('kibana.alert.severity') && !doc['kibana.alert.severity'].empty) {
          emit(doc['kibana.alert.severity'].value.toString().toLowerCase());
          return;
        }

        if (doc.containsKey('tlsoc.alert.severity') && !doc['tlsoc.alert.severity'].empty) {
          emit(doc['tlsoc.alert.severity'].value.toString().toLowerCase());
          return;
        }

        if (doc.containsKey('log.level') && !doc['log.level'].empty) {
          def level = doc['log.level'].value.toString().toLowerCase();
          if (level == 'critical' || level == 'fatal' || level == 'error') {
            emit('high');
          } else if (level == 'warn' || level == 'warning') {
            emit('medium');
          } else {
            emit('low');
          }
          return;
        }

        if (doc.containsKey('event.severity') && !doc['event.severity'].empty) {
          def sev = doc['event.severity'].value;
          if (sev >= 8) {
            emit('critical');
          } else if (sev >= 6) {
            emit('high');
          } else if (sev >= 4) {
            emit('medium');
          } else {
            emit('low');
          }
          return;
        }

        emit('low');
      `,
    },
  },
});

const buildWorkflowRuntimeMappings = (): Record<string, estypes.MappingRuntimeField> => ({
  workflow_normalized: {
    type: 'keyword',
    script: {
      source: `
        if (doc.containsKey('kibana.alert.workflow_status') && !doc['kibana.alert.workflow_status'].empty) {
          emit(doc['kibana.alert.workflow_status'].value.toString().toLowerCase());
          return;
        }

        if (doc.containsKey('kibana.alert.status') && !doc['kibana.alert.status'].empty) {
          def status = doc['kibana.alert.status'].value.toString().toLowerCase();
          if (status == 'active') {
            emit('open');
          } else {
            emit('closed');
          }
          return;
        }

        emit('open');
      `,
    },
  },
});

/**
 * Builds query for aggregating alerts over time.
 */
export const buildAlertsOverTimeQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
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
        fixed_interval: getAlertsHistogramInterval(params.from),
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
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
  size: 0,
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    by_severity: {
      filters: {
        filters: {
          critical: {
            query_string: {
              query: 'tlsoc.alert.severity : "critical"',
            },
          },
          high: {
            query_string: {
              query: 'tlsoc.alert.severity : "high"',
            },
          },
          medium: {
            query_string: {
              query: 'tlsoc.alert.severity : "medium"',
            },
          },
          low: {
            query_string: {
              query: 'tlsoc.alert.severity : "low"',
            },
          },
        },
      },
    },
  },
});

/**
 * Builds query for top alert rules.
 */
export const buildTopRulesQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
  size: 0,
  runtime_mappings: {
    rule_name_runtime: {
      type: 'keyword',
      script: {
        source: `
          if (doc.containsKey('kibana.alert.rule.name') && !doc['kibana.alert.rule.name'].empty) {
            emit(doc['kibana.alert.rule.name'].value.toString());
            return;
          }

          if (doc.containsKey('rule.name') && !doc['rule.name'].empty) {
            emit(doc['rule.name'].value.toString());
            return;
          }

          if (doc.containsKey('event.action') && !doc['event.action'].empty) {
            emit(doc['event.action'].value.toString());
            return;
          }

          emit('unknown-rule');
        `,
      },
    },
  },
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    top_rules: {
      terms: {
        field: 'rule_name_runtime',
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
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
  size: 0,
  runtime_mappings: {
    user_name_runtime: {
      type: 'keyword',
      script: {
        source: `
          def src = params['_source'];
          if (src != null && src.containsKey('user') && src.user != null && src.user instanceof Map) {
            def userObj = src.user;
            if (userObj.containsKey('name') && userObj.name != null) {
              emit(userObj.name.toString());
              return;
            }
          }

          if (doc.containsKey('user.name.keyword') && !doc['user.name.keyword'].empty) {
            emit(doc['user.name.keyword'].value.toString());
            return;
          }

          emit('unknown-user');
        `,
      },
    },
  },
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    top_users: {
      terms: {
        field: 'user_name_runtime',
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
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
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
 * Builds query for alerts by server/host.
 */
export const buildAlertsByServerQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
  size: 0,
  runtime_mappings: {
    server_name_runtime: {
      type: 'keyword',
      script: {
        source: `
          if (doc.containsKey('observer.server.keyword') && !doc['observer.server.keyword'].empty) {
            emit(doc['observer.server.keyword'].value.toString());
            return;
          }
          if (doc.containsKey('observer.server') && !doc['observer.server'].empty) {
            emit(doc['observer.server'].value.toString());
            return;
          }
          if (doc.containsKey('host.name.keyword') && !doc['host.name.keyword'].empty) {
            emit(doc['host.name.keyword'].value.toString());
            return;
          }
          if (doc.containsKey('host.name') && !doc['host.name'].empty) {
            emit(doc['host.name'].value.toString());
            return;
          }
          emit('unknown-server');
        `,
      },
    },
  },
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    by_server: {
      terms: {
        field: 'server_name_runtime',
        size: 20,
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
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
  size: 20,
  _source: [
    '@timestamp',
    'kibana.alert.severity',
    'risk_score',
    'kibana.alert.risk_score',
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
      ],
      should: [
        { range: { risk_score: { gte: 70 } } },
        { range: { 'kibana.alert.risk_score': { gte: 70 } } },
        { term: { 'kibana.alert.status': 'active' } },
        { term: { 'event.outcome': 'failure' } },
      ],
      minimum_should_match: 1,
    },
  },
  sort: [
    { 'kibana.alert.risk_score': { order: 'desc', unmapped_type: 'double' } },
    { risk_score: { order: 'desc', unmapped_type: 'double' } },
    { '@timestamp': { order: 'desc' } },
  ],
});

/**
 * Builds query for summary count metrics.
 */
export const buildSummaryCountsQuery = (params: TimeRangeParams): estypes.SearchRequest => ({
  index: params.index,
  size: 0,
  allow_no_indices: true,
  ignore_unavailable: true,
  expand_wildcards: ['open', 'hidden'],
  runtime_mappings: {
    ...buildSeverityRuntimeMappings(),
    ...buildWorkflowRuntimeMappings(),
  },
  query: {
    bool: {
      filter: [buildBaseTimeFilter(params)],
    },
  },
  aggs: {
    total_open: {
      filter: {
        term: { workflow_normalized: 'open' },
      },
    },
    high_critical: {
      filter: {
        terms: { severity_normalized: ['high', 'critical'] },
      },
    },
  },
});
