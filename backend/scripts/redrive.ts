import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { loadOutputs } from './outputs.js';

const outputs = loadOutputs();
const { getGeneration, updateGeneration } = await import('../src/data/generations.js');
const dryRun = process.argv.includes('--dry-run');
const sqs = new SQSClient({ region: outputs.Region });
const lambdaClient = new LambdaClient({ region: outputs.Region });
let handled = 0;

for (;;) {
  const batch = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: outputs.GenerateDlqUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 60,
    }),
  );
  if (!batch.Messages?.length) {
    break;
  }
  for (const message of batch.Messages) {
    const record = JSON.parse(message.Body ?? '{}') as {
      requestPayload?: { clientId?: string; generationId?: string };
    };
    const { clientId, generationId } = record.requestPayload ?? {};
    const generation =
      clientId && generationId ? await getGeneration(clientId, generationId) : undefined;
    if (!generation) {
      console.log(`skip: no generation for ${JSON.stringify(record.requestPayload)}`);
    } else if (dryRun) {
      console.log(`would retry generation ${generationId} (status ${generation.status})`);
      continue;
    } else {
      await updateGeneration(clientId!, generationId!, { status: 'queued', error: undefined });
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: outputs.GenerateFunctionName,
          InvocationType: 'Event',
          Payload: JSON.stringify({ clientId, generationId }),
        }),
      );
      console.log(`retried generation ${generationId}`);
    }
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: outputs.GenerateDlqUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
    handled++;
  }
  if (dryRun) {
    break;
  }
}
console.log(dryRun ? 'dry run: nothing changed' : `${handled} message(s) handled`);
