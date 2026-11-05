import { spawnSync } from 'child_process';
import { join } from 'path';

describe('OD-D2W database grants', () => {
  it('blocks partner writes of funding mode and duplicate obligations', () => {
    const runner = join(__dirname, 'db-grant.runner.mjs');
    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `database grant runner failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      );
    }
  }, 60000);
});
