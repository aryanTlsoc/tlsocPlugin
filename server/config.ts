import { schema, TypeOf } from '@kbn/config-schema';
import type { PluginConfigDescriptor } from '../../../src/core/server';

const configSchema = schema.object({
  alertsIndex: schema.string({ defaultValue: '.alerts-security.alerts-tlsoc*' }),
  severityIndex: schema.string({ defaultValue: '.alerts-security.alerts-tlsoc*' }),
});

export type TlsocPluginConfig = TypeOf<typeof configSchema>;

export const config: PluginConfigDescriptor<TlsocPluginConfig> = {
  schema: configSchema,
};
