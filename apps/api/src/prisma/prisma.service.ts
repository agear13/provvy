import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

// Use require to avoid TS/module interop issues with @prisma/client in CI
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    if (typeof this.$connect === 'function') {
      await this.$connect();
    }
  }

  async onModuleDestroy() {
    if (typeof this.$disconnect === 'function') {
      await this.$disconnect();
    }
  }
}
