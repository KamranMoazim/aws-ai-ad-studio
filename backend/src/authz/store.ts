import {
  CreatePolicyCommand,
  DeletePolicyCommand,
  ResourceNotFoundException,
  VerifiedPermissionsClient,
} from '@aws-sdk/client-verifiedpermissions';
import type { RoleInput } from '../core/schemas.js';
import { rolePolicies } from './policies.js';

const avpClient = new VerifiedPermissionsClient({});

export async function createRolePolicies(roleId: string, role: RoleInput): Promise<string[]> {
  const policyIds: string[] = [];
  for (const statement of rolePolicies(roleId, role)) {
    const response = await avpClient.send(
      new CreatePolicyCommand({
        policyStoreId: process.env.POLICY_STORE_ID!,
        definition: { static: { description: `role:${roleId}`, statement } },
      }),
    );
    policyIds.push(response.policyId!);
  }
  return policyIds;
}

export async function deletePolicies(policyIds: string[]): Promise<void> {
  for (const policyId of policyIds) {
    try {
      await avpClient.send(
        new DeletePolicyCommand({ policyStoreId: process.env.POLICY_STORE_ID!, policyId }),
      );
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}
