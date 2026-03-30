/**
 * Parsers for Elasticsearch response shapes into typed dashboard data.
 */

import type { estypes } from '@elastic/elasticsearch';
import type {
  AlertsByMitre,
  AlertsByRule,
  AlertsBySeverity,
  AlertsByUser,
  AlertsOverTime,
  SecurityAlert,
  MitreTactic,
  MitreTechnique,
  AlertSeverity,
  AlertStatus,
  AlertWorkflowStatus,
} from '../../../common/types';

const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');
const safeNumber = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

const normalizeSeverity = (value: unknown): AlertSeverity => {
  const str = (value as string | undefined)?.toString().toLowerCase();
  if (str === 'critical' || str === 'high' || str === 'medium' || str === 'low') {
    return str;
  }
  return 'low';
};

const normalizeWorkflowStatus = (value: unknown): AlertWorkflowStatus => {
  const str = (value as string | undefined)?.toString().toLowerCase();
  if (str === 'open' || str === 'acknowledged' || str === 'closed') {
    return str;
  }
  return 'open';
};

const normalizeStatus = (value: unknown): AlertStatus => {
  const str = (value as string | undefined)?.toString().toLowerCase();
  if (str === 'active' || str === 'recovered') {
    return str;
  }
  return 'active';
};

const parseMitreTacticItem = (input: unknown): MitreTactic | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const id = safeString(record.id);
  const name = safeString(record.name);
  const reference = safeString(record.reference);
  if (!id || !name) {
    return null;
  }
  return { id, name, reference };
};

const parseMitreTechniqueItem = (input: unknown): MitreTechnique | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const id = safeString(record.id);
  const name = safeString(record.name);
  const reference = safeString(record.reference);
  const subtechniqueRaw = record.subtechnique;
  const subtechniqueArray = Array.isArray(subtechniqueRaw)
    ? subtechniqueRaw
        .map((item) => parseMitreTechniqueItem(item))
        .filter((item): item is MitreTechnique => item !== null)
    : [];

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    reference,
    subtechnique: subtechniqueArray,
  };
};

/**
 * Parse alerts over time aggregation result.
 */
export const parseAlertsOverTime = (esResponse: estypes.SearchResponse<unknown>): AlertsOverTime => {
  const aggs = esResponse.aggregations as Record<string, unknown> | undefined;
  const buckets = (((aggs?.alerts_over_time as Record<string, unknown> | undefined)?.buckets as unknown[]) ?? []) as unknown[];
  return buckets.map((bucket) => {
    const item = bucket as Record<string, unknown>;
    return {
      timestamp: safeString(item.key_as_string),
      count: safeNumber(item.doc_count),
    };
  });
};

/**
 * Parse alerts by severity aggregation result.
 */
export const parseAlertsBySeverity = (esResponse: estypes.SearchResponse<unknown>): AlertsBySeverity => {
  const aggs = esResponse.aggregations as Record<string, unknown> | undefined;
  const buckets = (((aggs?.by_severity as Record<string, unknown> | undefined)?.buckets as unknown[]) ?? []) as unknown[];
  return buckets.map((bucket) => {
    const item = bucket as Record<string, unknown>;
    return {
      severity: normalizeSeverity(item.key),
      count: safeNumber(item.doc_count),
    };
  });
};

/**
 * Parse top rules aggregation result.
 */
export const parseTopRules = (esResponse: estypes.SearchResponse<unknown>): AlertsByRule => {
  const aggs = esResponse.aggregations as Record<string, unknown> | undefined;
  const buckets = (((aggs?.top_rules as Record<string, unknown> | undefined)?.buckets as unknown[]) ?? []) as unknown[];
  return buckets.map((bucket) => {
    const item = bucket as Record<string, unknown>;
    return {
      ruleName: safeString(item.key),
      count: safeNumber(item.doc_count),
    };
  });
};

/**
 * Parse top users aggregation result.
 */
export const parseTopUsers = (esResponse: estypes.SearchResponse<unknown>): AlertsByUser => {
  const aggs = esResponse.aggregations as Record<string, unknown> | undefined;
  const buckets = (((aggs?.top_users as Record<string, unknown> | undefined)?.buckets as unknown[]) ?? []) as unknown[];
  return buckets.map((bucket) => {
    const item = bucket as Record<string, unknown>;
    return {
      userName: safeString(item.key),
      count: safeNumber(item.doc_count),
    };
  });
};

/**
 * Parse MITRE tactics aggregation result.
 */
export const parseMitreTactics = (esResponse: estypes.SearchResponse<unknown>): AlertsByMitre => {
  const aggs = esResponse.aggregations as Record<string, unknown> | undefined;
  const buckets = (((aggs?.mitre_tactics as Record<string, unknown> | undefined)?.buckets as unknown[]) ?? []) as unknown[];
  return buckets.map((bucket) => {
    const item = bucket as Record<string, unknown>;
    return {
      tacticName: safeString(item.key),
      count: safeNumber(item.doc_count),
    };
  });
};

/**
 * Parse recent high-risk hits response into SecurityAlert array.
 */
export const parseRecentHighRisk = (esResponse: estypes.SearchResponse<unknown>): SecurityAlert[] => {
  const hits = (esResponse.hits?.hits ?? []) as Array<estypes.SearchHit<unknown>>;

  return hits
    .map((hit) => {
      const source = hit._source as Record<string, unknown> | undefined;
      if (!source) {
        return null;
      }

      const rawTactics = source['kibana.alert.rule.threat.tactic'];
      const trailTactics = Array.isArray(rawTactics)
        ? rawTactics.map((item) => parseMitreTacticItem(item)).filter((t): t is MitreTactic => t !== null)
        : [];

      const rawTechniques = source['kibana.alert.rule.threat.technique'];
      const trailTechniques = Array.isArray(rawTechniques)
        ? rawTechniques.map((item) => parseMitreTechniqueItem(item)).filter((t): t is MitreTechnique => t !== null)
        : [];

      const alert: SecurityAlert = {
        timestamp: safeString(source['@timestamp']),
        severity: normalizeSeverity(source['kibana.alert.severity']),
        riskScore: safeNumber(source.risk_score),
        status: normalizeStatus(source['kibana.alert.status']),
        workflowStatus: normalizeWorkflowStatus(source['kibana.alert.workflow_status']),
        ruleName: safeString(source['kibana.alert.rule.name']),
        ruleId: safeString(source['kibana.alert.rule.uuid'] ?? source['kibana.alert.rule.id']),
        userName: safeString(source['user.name']),
        targetUserName: safeString(source['user.target.name'] ?? source['user.target']),
        observerServer: safeString(source['observer.server']),
        observerDept: safeString(source['observer.department'] ?? source['observer.dept']),
        serviceName: safeString(source['service.name']),
        mitreTactics: trailTactics,
        mitreTechniques: trailTechniques,
        originalEventAction: safeString(source['event.action']),
        alertUuid: safeString(source['kibana.alert.uuid'] ?? source['kibana.alert.id']),
      };

      return alert;
    })
    .filter((item): item is SecurityAlert => item !== null);
};

/**
 * Parse summary counts from the summary query response.
 */
export const parseSummaryCounts = (
  esResponse: estypes.SearchResponse<unknown>
): { total: number; openCount: number; highCriticalCount: number } => {
  const aggs = esResponse.aggregations as Record<string, unknown> | undefined;
  const totalAlertsAgg = aggs?.total_alerts as Record<string, unknown> | undefined;
  const totalOpenAgg = aggs?.total_open as Record<string, unknown> | undefined;
  const highCriticalAgg = aggs?.high_critical as Record<string, unknown> | undefined;

  const total = safeNumber(totalAlertsAgg?.value);
  const openCount = safeNumber(totalOpenAgg?.doc_count);
  const highCriticalCount = safeNumber(highCriticalAgg?.doc_count);

  return { total, openCount, highCriticalCount };
};
