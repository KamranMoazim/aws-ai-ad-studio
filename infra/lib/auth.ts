import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as verifiedpermissions from 'aws-cdk-lib/aws-verifiedpermissions';
import { Construct } from 'constructs';
import { CEDAR_SCHEMA } from '../../backend/src/authz/schema.js';
import { appFunction } from './function.js';

export interface AuthProps {
  table: dynamodb.ITableV2;
  appName: string;
}

export class Auth extends Construct {
  readonly userPool: cognito.UserPool;
  readonly webClient: cognito.UserPoolClient;
  readonly policyStore: verifiedpermissions.CfnPolicyStore;
  readonly customMessage: NodejsFunction;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.customMessage = appFunction(this, 'CustomMessage', {
      entry: 'src/cognito-message/handler.ts',
      environment: { TABLE_NAME: props.table.tableName, APP_NAME: props.appName },
    });
    props.table.grantReadData(this.customMessage);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'adstudio-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 12 },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      lambdaTriggers: { customMessage: this.customMessage },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.webClient = this.userPool.addClient('WebClient', {
      authFlows: { userSrp: true, adminUserPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.minutes(15),
      idTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.days(30),
    });

    this.policyStore = new verifiedpermissions.CfnPolicyStore(this, 'PolicyStore', {
      description: 'adstudio',
      validationSettings: { mode: 'STRICT' },
      schema: { cedarJson: JSON.stringify(CEDAR_SCHEMA) },
      deletionProtection: { mode: 'DISABLED' },
    });
  }
}
