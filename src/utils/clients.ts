import {
  createPublicClient,
  http,
  encodeFunctionData,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createSmartAccountClient } from 'permissionless'
import { toSimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { entryPoint07Address } from 'viem/account-abstraction'
import { arcTestnet, config } from '../config.js'
import { VAULT_ABI } from '../abis.js'

export const ownerAccount = privateKeyToAccount(config.relayerPrivateKey)

// Pure HTTP — no WebSocket dependency at all
// pollingInterval 1000ms matches Arc's sub-second block time
export const publicClient = createPublicClient({
  chain           : arcTestnet,
  transport       : http(arcTestnet.rpcUrls.default.http[0], {
    retryCount  : 5,
    retryDelay  : 1_000,
    timeout     : 15_000,
  }),
  pollingInterval : 1_000,
})

const pimlicoClient = createPimlicoClient({
  transport  : http(config.pimlicoUrl),
  entryPoint : {
    address : entryPoint07Address,
    version : '0.7',
  },
})

export async function buildSmartAccountClient() {
  const account = await toSimpleSmartAccount({
    client     : publicClient,
    owner      : ownerAccount,
    entryPoint : {
      address : entryPoint07Address,
      version : '0.7',
    },
  })

  const smartAccountClient = createSmartAccountClient({
    account,
    chain            : arcTestnet,
    bundlerTransport : http(config.pimlicoUrl),
    middleware: {
      sponsorUserOperation : pimlicoClient.sponsorUserOperation,
      gasPrice             : async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  })

  return { smartAccountClient, smartAccountAddress: account.address }
}

export function encodeDepositFor(user: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi          : VAULT_ABI,
    functionName : 'depositFor',
    args         : [user, amount],
  })
}