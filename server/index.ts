import { PluginInitializerContext } from '../../../src/core/server';

//  This exports static code and TypeScript types,
//  as well as, Kibana Platform `plugin()` initializer.

export async function plugin(initializerContext: PluginInitializerContext) {
  const { TlsocPluginPlugin } = await import('./plugin');
  return new TlsocPluginPlugin(initializerContext);
}

export type { TlsocPluginPluginSetup, TlsocPluginPluginStart } from './types';
