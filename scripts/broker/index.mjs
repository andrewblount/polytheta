import { TwsBroker } from './tws.mjs';
import { WebApiBroker } from './web-api.mjs';
export function brokerRuntime(settings, env = process.env) {
  const mode = settings.accountMode ?? 'live';
  if (!['live', 'paper'].includes(mode)) throw new Error('Invalid IB account mode');
  const paper = mode === 'paper';
  return {
    mode, account: (paper ? env.IBKR_PAPER_ACCOUNT_ID : env.IBKR_ACCOUNT_ID) ?? '',
    enabled: (paper ? env.POLYTHETA_PAPER_EXECUTION_ENABLED : env.POLYTHETA_EXECUTION_ENABLED) === 'true',
    importLedger: !paper, journalKey: `ib_execution_journal:${mode}`, journalFile: `ib-execution-${mode}.json`,
  };
}
export function createBroker(settings, env = process.env) {
  const runtime = brokerRuntime(settings, env);
  const account = { account: runtime.account, accountMode: runtime.mode };
  return settings.connection === 'web-api' ? new WebApiBroker({ ...account, baseUrl: settings.webApiUrl }) : new TwsBroker({ ...account, host: settings.twsHost, port: settings.twsPort, clientId: settings.twsClientId });
}
