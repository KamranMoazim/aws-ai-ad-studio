import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { documentClient, TABLE_NAME } from '../src/core/table.js';

export async function deletePartitions(partitionKeys: string[]): Promise<void> {
  for (const partitionKey of partitionKeys) {
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await documentClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': partitionKey },
          ProjectionExpression: 'PK, SK',
          ExclusiveStartKey: startKey,
        }),
      );
      const items = page.Items ?? [];
      for (let start = 0; start < items.length; start += 25) {
        await documentClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: items.slice(start, start + 25).map((item) => ({
                DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
              })),
            },
          }),
        );
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
  }
}
