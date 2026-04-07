import { IRouter, Logger } from '../../../../src/core/server';
import { schema } from '@kbn/config-schema';
import { AlertsResponse } from '../types';
import { createDashboardEsClient } from '../lib/es_client/dashboard_es_client';
import type { TlsocPluginConfig } from '../config';

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export function defineRoutes(router: IRouter, logger: Logger, config: TlsocPluginConfig) {
  logger.info('[tlsocPlugin] Registering routes');

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
}

