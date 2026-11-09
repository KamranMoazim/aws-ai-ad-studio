import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { clientPk, TXN_PREFIX, txnSk, TXNS_INDEX } from '../core/keys.js';
import type { Transaction } from '../core/schemas.js';
import { documentClient, GSI1, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export async function createTransaction(txn: Transaction): Promise<boolean> {
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: clientPk(txn.clientId),
          SK: txnSk(txn.createdAt, txn.txnId),
          GSI1PK: TXNS_INDEX,
          GSI1SK: `${txn.createdAt}#${txn.txnId}`,
          ...txn,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (error) {
    if ((error as Error).name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
}

export async function markRefunded(txn: Pick<Transaction, 'clientId' | 'createdAt' | 'txnId'>) {
  await documentClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(txn.clientId), SK: txnSk(txn.createdAt, txn.txnId) },
      UpdateExpression: 'SET #status = :refunded, refundedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':refunded': 'refunded', ':now': new Date().toISOString() },
    }),
  );
}

export async function listClientTransactions(clientId: string): Promise<Transaction[]> {
  const items: Transaction[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': clientPk(clientId), ':prefix': TXN_PREFIX },
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []).map((item) => withoutKeys<Transaction>(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function listTransactions(from: string, to: string): Promise<Transaction[]> {
  const items: Transaction[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': TXNS_INDEX, ':from': from, ':to': `${to}~` },
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []).map((item) => withoutKeys<Transaction>(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}
