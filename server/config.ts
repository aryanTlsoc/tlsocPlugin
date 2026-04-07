import { schema, TypeOf } from '@kbn/config-schema';
import type { PluginConfigDescriptor } from '../../../src/core/server';

const configSchema = schema.object({
  alertsIndex: schema.string({ defaultValue: '.alerts-security*' }),
  severityIndex: schema.string({ defaultValue: 'tlsoc-alerts-*' }),
});

export type TlsocPluginConfig = TypeOf<typeof configSchema>;

export const config: PluginConfigDescriptor<TlsocPluginConfig> = {
  schema: configSchema,
};
