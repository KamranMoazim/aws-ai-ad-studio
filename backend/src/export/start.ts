import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { ExportRecord } from '../core/schemas.js';
import type { SizeKey } from '../../../shared/src/index.js';
import type { ExportInput } from './snapshot.js';

const sfnClient = new SFNClient({});

export const inputFor = (record: ExportRecord): ExportInput => ({
  exportId: record.exportId,
  projectId: record.projectId,
  clientId: record.clientId,
  createdAt: record.createdAt,
  snapshotKey: record.snapshotKey!,
  sizes: record.sizes as SizeKey[],
});

export async function startRender(record: ExportRecord): Promise<void> {
  try {
    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: process.env.EXPORT_STATE_MACHINE_ARN!,
        name: `export-${record.exportId}`,
        input: JSON.stringify(inputFor(record)),
      }),
    );
  } catch (error) {
    if ((error as Error).name !== 'ExecutionAlreadyExists') {
      throw error;
    }
  }
}
