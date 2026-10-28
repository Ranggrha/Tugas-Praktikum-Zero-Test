import 'dotenv/config';
import { initializeDatabase, resetDatabaseForTests } from '../database/db';
import { app as gatewayApp } from '../apps/gateway/src/app';
import { app as nilaiApp } from '../apps/service-nilai/src/app';
import { app as transkripApp } from '../apps/service-transkrip/src/app';

const started = globalThis as any;

beforeAll(async () => {
  if (!started.__siaZtServers) {
    started.__siaZtServers = {
      gateway: gatewayApp.listen(3000),
      nilai: nilaiApp.listen(3001),
      transkrip: transkripApp.listen(3002),
    };
  }
});

beforeEach(() => {
  initializeDatabase();
  resetDatabaseForTests();
  delete process.env.TEST_NOW_ISO;
});

afterAll(async () => {
  const servers = started.__siaZtServers as Record<string, any> | undefined;
  if (servers) {
    for (const server of Object.values(servers)) {
      await new Promise((resolve) => server.close(resolve));
    }
    delete started.__siaZtServers;
  }
});
