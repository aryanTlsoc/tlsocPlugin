/**
 * Parsers for Elasticsearch response shapes into typed dashboard data.
 */

import type { estypes } from '@elastic/elasticsearch';
import type {
  AlertsByMitre,
  AlertsByRule,
  AlertsByServer,
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
const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (Array.isArray(value)) {
      const found = value.find((item) => typeof item === 'string' && item.trim());
      if (typeof found === 'string') {
        return found;
      }
    }
  }

  return '';
};
const safePayloadString = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
};

const getField = (source: Record<string, unknown>, path: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(source, path)) {
    return source[path];
  }

  const parts = path.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const parseJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

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
  const bySeverityAgg = aggs?.by_severity as Record<string, unknown> | undefined;
  const rawBuckets = bySeverityAgg?.buckets;

  if (Array.isArray(rawBuckets)) {
    return rawBuckets.map((bucket) => {
      const item = bucket as Record<string, unknown>;
      return {
        severity: normalizeSeverity(item.key),
        count: safeNumber(item.doc_count),
      };
    });
  }

  if (rawBuckets && typeof rawBuckets === 'object') {
    return Object.entries(rawBuckets as Record<string, unknown>).map(([key, bucket]) => {
      const item = bucket as Record<string, unknown>;
      return {
        severity: normalizeSeverity(key),
        count: safeNumber(item.doc_count),
      };
    });
  }

  return [];
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
 * Parse alerts by server aggregation result.
 */
export const parseAlertsByServer = (esResponse: estypes.SearchResponse<unknown>): AlertsByServer => {
  const aggs = esResponse.aggregations as Record<string, unknown> | undefined;
  const buckets = (((aggs?.by_server as Record<string, unknown> | undefined)?.buckets as unknown[]) ?? []) as unknown[];
  return buckets.map((bucket) => {
    const item = bucket as Record<string, unknown>;
    return {
      serverName: safeString(item.key),
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

      const rawEventOriginal = safePayloadString(
        getField(source, 'event.original') ?? getField(source, 'event.payload') ?? getField(source, 'message')
      );
      const parsedEventOriginal = parseJsonRecord(rawEventOriginal) ?? {};
      const destinationIpFromEvent =
        getField(parsedEventOriginal, 'transaction.host_ip') ??
        getField(parsedEventOriginal, 'destination.ip') ??
        getField(parsedEventOriginal, 'destination.address');
      const sourceIpFromEvent =
        getField(parsedEventOriginal, 'source.ip') ??
        getField(parsedEventOriginal, 'source.address') ??
        getField(parsedEventOriginal, 'transaction.source_ip');
      const observerServerFromEvent =
        getField(parsedEventOriginal, 'transaction.server_id') ??
        getField(parsedEventOriginal, 'observer.server') ??
        getField(parsedEventOriginal, 'host.name');

      const rawTactics = getField(source, 'kibana.alert.rule.threat.tactic');
      const trailTactics = Array.isArray(rawTactics)
        ? rawTactics.map((item) => parseMitreTacticItem(item)).filter((t): t is MitreTactic => t !== null)
        : [];

      const rawTechniques = getField(source, 'kibana.alert.rule.threat.technique');
      const trailTechniques = Array.isArray(rawTechniques)
        ? rawTechniques.map((item) => parseMitreTechniqueItem(item)).filter((t): t is MitreTechnique => t !== null)
        : [];

      const tacticNameFromField = safeString(getField(source, 'kibana.alert.rule.threat.tactic.name'));
      const tacticNameFromLegacySignal = safeString(getField(source, 'signal.rule.threat.tactic.name'));
      const tacticNameFromArray = trailTactics[0]?.name ?? '';
      const mitreTacticName = tacticNameFromField || tacticNameFromLegacySignal || tacticNameFromArray;

      const eventId = firstNonEmptyString(
        getField(source, 'event.id') ??
          getField(source, 'kibana.alert.original_event.id') ??
          getField(source, 'kibana.alert.id') ??
          getField(source, 'kibana.alert.uuid') ??
          getField(source, 'tlsoc.alert.id') ??
          hit._id
      );

      const alert: SecurityAlert = {
        timestamp: safeString(getField(source, '@timestamp')),
        severity: normalizeSeverity(getField(source, 'tlsoc.alert.severity') ?? getField(source, 'kibana.alert.severity') ?? getField(source, 'event.severity')),
        riskScore: safeNumber(getField(source, 'tlsoc.alert.risk_score') ?? getField(source, 'kibana.alert.risk_score') ?? getField(source, 'risk_score')),
        status: normalizeStatus(getField(source, 'tlsoc.alert.status') ?? getField(source, 'kibana.alert.status')),
        workflowStatus: normalizeWorkflowStatus(getField(source, 'kibana.alert.workflow_status')),
        ruleName: firstNonEmptyString(getField(source, 'tlsoc.alert.name'), getField(source, 'kibana.alert.rule.name')),
        ruleId: firstNonEmptyString(getField(source, 'kibana.alert.rule.uuid'), getField(source, 'kibana.alert.rule.id'), getField(source, 'tlsoc.alert.id')),
        userName: firstNonEmptyString(getField(source, 'user.name')),
        targetUserName: firstNonEmptyString(getField(source, 'user.target.name'), getField(source, 'user.target')),
        sourceIp: firstNonEmptyString(
          getField(source, 'source.ip'),
          getField(source, 'source.address'),
          sourceIpFromEvent
        ),
        destinationIp: firstNonEmptyString(
          getField(source, 'destination.ip') ?? getField(source, 'destination.address') ?? destinationIpFromEvent
        ),
        eventPayload: rawEventOriginal,
        observerServer: firstNonEmptyString(getField(source, 'observer.server'), getField(source, 'host.name'), observerServerFromEvent),
        observerDept: firstNonEmptyString(getField(source, 'observer.department'), getField(source, 'observer.dept')),
        serviceName: firstNonEmptyString(getField(source, 'service.name')),
        mitreTactics: trailTactics,
        mitreTechniques: trailTechniques,
        mitreTacticName,
        originalEventAction: firstNonEmptyString(getField(source, 'event.action')),
        alertUuid: firstNonEmptyString(getField(source, 'kibana.alert.uuid'), getField(source, 'kibana.alert.id'), getField(source, 'tlsoc.alert.id')),
        eventId,
        eventOriginal: rawEventOriginal,
        signalStatus: firstNonEmptyString(getField(source, 'signal.status')),
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
  const totalMatchingSeverityAgg = aggs?.total_matching_severity as Record<string, unknown> | undefined;
  const totalOpenAgg = aggs?.total_open as Record<string, unknown> | undefined;
  const highCriticalAgg = aggs?.high_critical as Record<string, unknown> | undefined;

  const total = safeNumber(totalMatchingSeverityAgg?.doc_count);
  const openCount = safeNumber(totalOpenAgg?.doc_count);
  const highCriticalCount = safeNumber(highCriticalAgg?.doc_count);

  return { total, openCount, highCriticalCount };
};
