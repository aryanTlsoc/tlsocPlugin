import { IRouter, Logger } from '../../../../src/core/server';
import { schema } from '@kbn/config-schema';
import { AlertsResponse } from '../types';
import { createDashboardEsClient } from '../lib/es_client/dashboard_es_client';
import { AlertMailerService } from '../lib/alert_mailer_service';
import type { TlsocPluginConfig } from '../config';

const ALERTS_INDEX = 'tlsoc-alerts-*,.alerts-security*';

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export function defineRoutes(router: IRouter, logger: Logger, alertMailerService: AlertMailerService, config: TlsocPluginConfig) {
  logger.info('[tlsocPlugin] Registering routes');

  router.post(
    {
      path: '/api/tlsoc_plugin/mailer/configure',
      validate: {
        body: schema.object({
          smtp_host: schema.string(),
          smtp_port: schema.number({ min: 1, max: 65535 }),
          smtp_secure: schema.maybe(schema.boolean()),
          smtp_username: schema.string(),
          smtp_password: schema.string(),
          smtp_from: schema.string(),
          admin_email: schema.maybe(schema.string()),
          poll_interval_seconds: schema.maybe(schema.number({ min: 5, max: 3600 })),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const body = request.body;
        alertMailerService.configure({
          smtp: {
            host: body.smtp_host,
            port: body.smtp_port,
            secure: body.smtp_secure ?? false,
            username: body.smtp_username,
            password: body.smtp_password,
            from: body.smtp_from,
          },
          adminEmail: body.admin_email,
          pollIntervalSeconds: body.poll_interval_seconds,
        });

        await alertMailerService.activate();

        return response.ok({
          body: {
            message: 'Mailer configured successfully',
            status: alertMailerService.getStatus(),
          },
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to configure mailer: ${errorMessage}`,
          },
        });
      }
    }
  );

  router.post(
    {
      path: '/api/tlsoc_plugin/mailer/activate',
      validate: false,
    },
    async (context, request, response) => {
      try {
        await alertMailerService.activate();
        return response.ok({
          body: {
            message: 'Mailer activated',
            status: alertMailerService.getStatus(),
          },
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to activate mailer: ${errorMessage}`,
          },
        });
      }
    }
  );

  router.post(
    {
      path: '/api/tlsoc_plugin/mailer/deactivate',
      validate: false,
    },
    async (context, request, response) => {
      alertMailerService.deactivate();
      return response.ok({
        body: {
          message: 'Mailer deactivated',
          status: alertMailerService.getStatus(),
        },
      });
    }
  );

  router.get(
    {
      path: '/api/tlsoc_plugin/mailer/status',
      validate: false,
    },
    async (context, request, response) => {
      return response.ok({
        body: {
          status: alertMailerService.getStatus(),
        },
      });
    }
  );

  router.get(
    {
      path: '/api/tlsoc_plugin/example',
      validate: false,
    },
    async (context, request, response) => {
      return response.ok({
        body: {
          time: new Date().toISOString(),
        },
      });
    }
  );

  // Get all security alerts
  router.get(
    {
      path: '/api/tlsoc_plugin/alerts',
      validate: {
        query: schema.object({
          size: schema.maybe(schema.number({ min: 1, max: 10000 })),
          from: schema.maybe(schema.number({ min: 0 })),
          severity: schema.maybe(schema.string()),
          status: schema.maybe(schema.string()),
          rule_name: schema.maybe(schema.string()),
          user_name: schema.maybe(schema.string()),
          from_date: schema.maybe(schema.string()),
          to_date: schema.maybe(schema.string()),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const {
          size = 20,
          from = 0,
          severity,
          status,
          rule_name,
          user_name,
          from_date,
          to_date,
        } = request.query;

        // Build Elasticsearch query
        const query: any = {
          bool: {
            must: [],
            filter: [],
          },
        };

        // Add filters
        if (severity) {
          query.bool.filter.push({
            term: { 'kibana.alert.severity': severity },
          });
        }

        if (status) {
          query.bool.filter.push({
            term: { 'kibana.alert.status': status },
          });
        }

        if (rule_name) {
          query.bool.must.push({
            match: { 'kibana.alert.rule.name': rule_name },
          });
        }

        if (user_name) {
          query.bool.filter.push({
            term: { 'user.name': user_name },
          });
        }

        // Add time range filter
        if (from_date || to_date) {
          const range: any = { '@timestamp': {} };
          if (from_date) range['@timestamp'].gte = from_date;
          if (to_date) range['@timestamp'].lte = to_date;
          query.bool.filter.push({ range });
        }

        const esQuery = {
          index: config.alertsIndex,
          body: {
            from,
            size,
            sort: [{ '@timestamp': { order: 'desc' } }],
            query,
          },
        };

        const coreContext = await context.core;
        const esClient = coreContext.elasticsearch.client.asCurrentUser;
        const result = await esClient.search(esQuery);
        const body = (result as any).body ?? result;

        return response.ok({
          body: body as AlertsResponse,
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to fetch alerts: ${errorMessage}`,
          },
        });
      }
    }
  );

  // Get specific alert by ID
  router.get(
    {
      path: '/api/tlsoc_plugin/alerts/{id}',
      validate: {
        params: schema.object({
          id: schema.string(),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { id } = request.params;

        const esQuery = {
          index: config.alertsIndex,
          body: {
            query: {
              term: { 'kibana.alert.uuid': id },
            },
          },
        };

        const coreContext = await context.core;
        const esClient = coreContext.elasticsearch.client.asCurrentUser;
        const result = await esClient.search(esQuery);
        const body = (result as any).body ?? result;

        if (body.hits.hits.length === 0) {
          return response.notFound({
            body: { message: 'Alert not found' },
          });
        }

        return response.ok({
          body: body.hits.hits[0],
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to fetch alert: ${errorMessage}`,
          },
        });
      }
    }
  );

  // Get alert statistics
  router.get(
    {
      path: '/api/tlsoc_plugin/alerts/stats',
      validate: {
        query: schema.object({
          from_date: schema.maybe(schema.string()),
          to_date: schema.maybe(schema.string()),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { from_date, to_date } = request.query;

        const query: any = {
          bool: {
            filter: [],
          },
        };

        // Add time range filter
        if (from_date || to_date) {
          const range: any = { '@timestamp': {} };
          if (from_date) range['@timestamp'].gte = from_date;
          if (to_date) range['@timestamp'].lte = to_date;
          query.bool.filter.push({ range });
        }

        const esQuery = {
          index: config.alertsIndex,
          body: {
            size: 0,
            query,
            aggs: {
              severity_stats: {
                terms: { field: 'kibana.alert.severity' },
              },
              status_stats: {
                terms: { field: 'kibana.alert.status' },
              },
              rule_stats: {
                terms: { field: 'kibana.alert.rule.name', size: 10 },
              },
              timeline: {
                date_histogram: {
                  field: '@timestamp',
                  calendar_interval: '1h',
                },
              },
            },
          },
        };

        const coreContext = await context.core;
        const esClient = coreContext.elasticsearch.client.asCurrentUser;
        const result = await esClient.search(esQuery);
        const body = (result as any).body ?? result;

        return response.ok({
          body: {
            total: typeof body.hits.total === 'number' ? body.hits.total : body.hits.total.value,
            aggregations: body.aggregations,
          },
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to fetch alert statistics: ${errorMessage}`,
          },
        });
      }
    }
  );

  // Dashboard metrics route
  router.get(
    {
      path: '/api/tlsoc_plugin/dashboard/metrics',
      validate: {
        query: schema.object({
          from_date: schema.maybe(schema.string()),
          to_date: schema.maybe(schema.string()),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { from_date, to_date } = request.query;
        const coreContext = await context.core;
        const client = createDashboardEsClient(
          coreContext.elasticsearch.client,
          logger,
          {
            alertsIndex: config.alertsIndex,
            severityIndex: config.severityIndex,
          }
        );

        const dashboard = await client.getDashboardMetrics({
          index: config.alertsIndex,
          from: from_date ?? 'now-90d',
          to: to_date ?? 'now',
        });

        return response.ok({ body: dashboard });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to fetch dashboard metrics: ${errorMessage}`,
          },
        });
      }
    }
  );

  router.get(
    {
      path: '/api/tlsoc_plugin/dashboard/alerts_by_server',
      validate: {
        query: schema.object({
          from_date: schema.maybe(schema.string()),
          to_date: schema.maybe(schema.string()),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { from_date, to_date } = request.query;
        const coreContext = await context.core;
        const client = createDashboardEsClient(
          coreContext.elasticsearch.client,
          logger,
          { alertsIndex: config.alertsIndex }
        );

        const result = await client.getAlertsByServer({
          index: config.alertsIndex,
          from: from_date ?? 'now-90d',
          to: to_date ?? 'now',
        });

        return response.ok({ body: result });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.error(`alerts_by_server failed: ${errorMessage}`);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to fetch alerts by server: ${errorMessage}`,
          },
        });
      }
    }
  );

  router.get(
    {
      path: '/api/tlsoc_plugin/dashboard/alert_details',
      validate: {
        query: schema.object({
          alert_uuid: schema.maybe(schema.string()),
          rule_name: schema.maybe(schema.string()),
          timestamp: schema.maybe(schema.string()),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { alert_uuid, rule_name, timestamp } = request.query;
        const coreContext = await context.core;
        const esClient = coreContext.elasticsearch.client.asCurrentUser;

        const getByPath = (obj: Record<string, any>, path: string) => {
          if (Object.prototype.hasOwnProperty.call(obj, path)) {
            return obj[path];
          }
          return path.split('.').reduce((acc: any, key: string) => {
            if (acc && typeof acc === 'object') {
              return acc[key];
            }
            return undefined;
          }, obj);
        };

        const firstNonEmptyString = (...values: any[]): string => {
          for (const v of values) {
            if (typeof v === 'string' && v.trim()) {
              return v;
            }
            if (Array.isArray(v)) {
              const found = v.find((x) => typeof x === 'string' && x.trim());
              if (found) {
                return found;
              }
            }
          }
          return '';
        };

        const parseJsonRecord = (value: unknown): Record<string, any> | undefined => {
          if (!value || typeof value !== 'string') {
            return undefined;
          }

          try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              return parsed as Record<string, any>;
            }
          } catch {
            return undefined;
          }

          return undefined;
        };

        const shouldQueries: any[] = [];
        if (alert_uuid) {
          shouldQueries.push({ term: { 'kibana.alert.uuid': alert_uuid } });
          shouldQueries.push({ term: { 'kibana.alert.id': alert_uuid } });
          shouldQueries.push({ term: { 'tlsoc.alert.id': alert_uuid } });
        } else {
          if (rule_name) {
            shouldQueries.push({ match: { 'kibana.alert.rule.name': rule_name } });
            shouldQueries.push({ match: { 'tlsoc.alert.name': rule_name } });
          }

          if (timestamp) {
            shouldQueries.push({
              range: {
                '@timestamp': {
                  gte: `${timestamp}||-10m`,
                  lte: `${timestamp}||+10m`,
                },
              },
            });
          }
        }

        const result = await esClient.search({
          index: ALERTS_INDEX,
          size: 1,
          sort: [{ '@timestamp': { order: 'desc' } }],
          _source: [
            '@timestamp',
            'tlsoc.alert.id',
            'tlsoc.alert.name',
            'tlsoc.alert.status',
            'tlsoc.alert.risk_score',
            'kibana.alert.uuid',
            'kibana.alert.id',
            'kibana.alert.original_event.id',
            'kibana.alert.rule.name',
            'source.ip',
            'source.address',
            'destination.ip',
            'destination.address',
            'observer.server',
            'host.name',
            'event.id',
            'event.payload',
            'event.original',
            'event.action',
            'message',
            'kibana.alert.rule.threat.tactic.name',
            'kibana.alert.rule.threat.tactic',
            'signal.rule.threat.tactic.name',
            'signal.rule.threat.tactic',
            'signal.status',
          ],
          query: {
            bool: {
              should: shouldQueries,
              minimum_should_match: shouldQueries.length > 0 ? 1 : 0,
            },
          },
        });

        const body = (result as any).body ?? result;
        const hit = body.hits?.hits?.[0];

        if (!hit?._source) {
          return response.notFound({
            body: { message: 'Alert details not found' },
          });
        }

        const source = hit._source as Record<string, any>;
        const sourceIp = getByPath(source, 'source.ip') ?? getByPath(source, 'source.address') ?? '';
        const eventOriginalRaw = getByPath(source, 'event.original') ?? getByPath(source, 'event.payload') ?? getByPath(source, 'message') ?? '';
        const eventOriginalParsed = parseJsonRecord(eventOriginalRaw);
        const eventOriginalData = eventOriginalParsed ?? {};
        const destinationIp =
          getByPath(source, 'destination.ip') ??
          getByPath(source, 'destination.address') ??
          getByPath(eventOriginalData, 'transaction.host_ip') ??
          '';
        const server = firstNonEmptyString(
          getByPath(source, 'observer.server'),
          getByPath(source, 'host.name'),
          getByPath(eventOriginalData, 'transaction.server_id'),
          getByPath(eventOriginalData, 'transaction.host_ip'),
          'N/A'
        );

        const eventId = firstNonEmptyString(
          getByPath(source, 'event.id'),
          getByPath(source, 'kibana.alert.original_event.id'),
          getByPath(source, 'kibana.alert.id'),
          getByPath(source, 'kibana.alert.uuid'),
          getByPath(source, 'tlsoc.alert.id'),
          hit._id,
          alert_uuid,
          'N/A'
        );

        const payload =
          getByPath(source, 'event.payload') ?? getByPath(source, 'event.original') ?? getByPath(source, 'message') ?? '';
        const eventOriginal = eventOriginalRaw;
        const signalStatus = firstNonEmptyString(getByPath(source, 'signal.status'));

        const tacticNamesFromArray = [
          ...(Array.isArray(getByPath(source, 'kibana.alert.rule.threat.tactic'))
            ? getByPath(source, 'kibana.alert.rule.threat.tactic').map((t: any) => t?.name)
            : []),
          ...(Array.isArray(getByPath(source, 'signal.rule.threat.tactic'))
            ? getByPath(source, 'signal.rule.threat.tactic').map((t: any) => t?.name)
            : []),
        ].filter(Boolean);

        const mitreTacticName = firstNonEmptyString(
          getByPath(source, 'kibana.alert.rule.threat.tactic.name'),
          getByPath(source, 'signal.rule.threat.tactic.name'),
          tacticNamesFromArray,
          'N/A'
        );

        return response.ok({
          body: {
            alertUuid: firstNonEmptyString(getByPath(source, 'kibana.alert.uuid'), getByPath(source, 'tlsoc.alert.id'), alert_uuid, hit._id),
            timestamp: getByPath(source, '@timestamp') ?? '',
            ruleName: firstNonEmptyString(getByPath(source, 'kibana.alert.rule.name'), getByPath(source, 'tlsoc.alert.name'), ''),
            sourceIp: typeof sourceIp === 'string' ? sourceIp : String(sourceIp ?? ''),
            destinationIp: typeof destinationIp === 'string' ? destinationIp : String(destinationIp ?? ''),
            server,
            eventId: typeof eventId === 'string' ? eventId : String(eventId ?? 'N/A'),
            payload,
            mitre: mitreTacticName,
            mitreTacticName,
            eventOriginal: typeof eventOriginal === 'string' ? eventOriginal : JSON.stringify(eventOriginal, null, 2),
            signalStatus: typeof signalStatus === 'string' ? signalStatus : String(signalStatus ?? ''),
            eventPayload: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
          },
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return response.customError({
          statusCode: 500,
          body: {
            message: `Failed to fetch alert details: ${errorMessage}`,
          },
        });
      }
    }
  );
}

