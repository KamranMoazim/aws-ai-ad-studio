import { Duration } from 'aws-cdk-lib';
import type * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

export const MONTHLY_BUDGET_USD = 50;
const PERIOD = Duration.minutes(5);

export interface MonitoringProps {
  alertEmail?: string;
  functions: Record<string, lambda.IFunction>;
  throttleWatch: Record<string, lambda.IFunction>;
  stateMachines: Record<string, sfn.IStateMachine>;
  httpApi: apigwv2.HttpApi;
  deadLetterQueue: sqs.IQueue;
}

export class Monitoring extends Construct {
  readonly topic: sns.Topic;
  readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);
    this.topic = new sns.Topic(this, 'Alerts', { displayName: 'AdStudio alerts' });
    if (props.alertEmail) {
      this.topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    }
    const alarm = (name: string, metric: cloudwatch.IMetric, description: string) => {
      const created = new cloudwatch.Alarm(this, name, {
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      });
      created.addAlarmAction(new actions.SnsAction(this.topic));
      this.alarms.push(created);
    };
    for (const [name, fn] of Object.entries(props.functions)) {
      alarm(
        `${name}Errors`,
        fn.metricErrors({ period: PERIOD, statistic: 'Sum' }),
        `${name} Lambda errors`,
      );
    }
    for (const [name, fn] of Object.entries(props.throttleWatch)) {
      alarm(
        `${name}Throttles`,
        fn.metricThrottles({ period: PERIOD, statistic: 'Sum' }),
        `${name} Lambda was throttled; see RUNBOOK.md (Lambda concurrency)`,
      );
    }
    for (const [name, machine] of Object.entries(props.stateMachines)) {
      alarm(
        `${name}Failed`,
        machine.metricFailed({ period: PERIOD, statistic: 'Sum' }),
        `${name} executions failed`,
      );
    }
    alarm(
      'Api5xx',
      props.httpApi.metricServerError({ period: PERIOD, statistic: 'Sum' }),
      'API returned 5xx errors',
    );
    alarm(
      'DeadLetters',
      props.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: PERIOD,
        statistic: 'Maximum',
      }),
      'Failed AI generations are waiting in the dead-letter queue; see RUNBOOK.md (redrive)',
    );

    if (props.alertEmail) {
      const subscriber = { subscriptionType: 'EMAIL', address: props.alertEmail };
      new budgets.CfnBudget(this, 'Budget', {
        budget: {
          budgetName: 'adstudio-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: MONTHLY_BUDGET_USD, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
            },
            subscribers: [subscriber],
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
            },
            subscribers: [subscriber],
          },
        ],
      });
    }
  }
}
