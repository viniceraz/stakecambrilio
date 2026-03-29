import { createPublicClient, http, fallback } from "viem";
import { base } from "wagmi/chains";

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY || "";

export const publicClient = createPublicClient({
  chain: base,
  transport: fallback([
    http(`https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`),
    http("https://mainnet.base.org"),
    http("https://base.llamarpc.com"),
  ]),
});

/**
 * Type-safe wrapper around publicClient.readContract that works around the
 * viem 2.18 bug where `authorizationList` is incorrectly required in
 * ReadContractParameters (EIP-7702 regression).
 */
export async function readContractSafe<T = unknown>(params: {
  address: `0x${string}`;
  abi: readonly object[];
  functionName: string;
  args?: unknown[];
}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (publicClient.readContract as any)(params) as T;
}
