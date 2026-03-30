import './index.scss';

import { TlsocPluginPlugin } from './plugin';

// This exports static code and TypeScript types,
// as well as, Kibana Platform `plugin()` initializer.
export function plugin() {
  return new TlsocPluginPlugin();
}
export type { TlsocPluginPluginSetup, TlsocPluginPluginStart } from './types';
