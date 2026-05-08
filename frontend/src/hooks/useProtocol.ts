import { useState, useEffect, useCallback } from "react";
import { BrowserProvider, JsonRpcProvider, Contract } from "ethers";
import FactoryABI from "../constants/FactoryABI.json";
import GrantPoolABI from "../constants/GrantPoolABI.json";
import type { GrantPool, PoolState } from "../types";

const SEPOLIA_RPC =
  (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined) ??
  "https://ethereum-sepolia-rpc.publicnode.com";

const STATE_MAP: PoolState[] = [
  "PENDING",
  "ACTIVE",
  "REVIEW",
  "DISTRIBUTING",
  "CLOSED",
  "CANCELLED",
];

export interface ProtocolStats {
  totalPools: number;
  activePools: number;
  totalFunded: string;      // raw 6-decimal string
  totalWinners: number;
  totalGrantsClaimed: string; // raw 6-decimal string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSummary(s: any): GrantPool {
  return {
    address:           s.poolAddress as string,
    poolName:          s.poolName    as string,
    state:             STATE_MAP[Number(s.state)] ?? "CLOSED",
    creator:           s.creator     as string,
    treasury:          "",
    totalDeposited:    (s.totalDeposited  as bigint).toString(),
    distributionAmount:(s.distributionAmount as bigint).toString(),
    submissionStart:   Number(s.submissionStart),
    submissionEnd:     Number(s.submissionEnd),
    reviewEnd:         Number(s.reviewEnd),
    signers:           [],        // populated below if wallet connected
    winners:           [],        // only count matters for cards
    fieldDefinitions:  [],        // fetched on detail page
    isCancelled:       s.isCancelled       as boolean,
    distributionEntered: s.distributionEntered as boolean,
    createdAt:         Number(s.submissionStart), // best proxy without a createdAt field
    signerCount:       Number(s.signerCount),
    winnersCount:      Number(s.winnersCount),
    proposalCount:     Number(s.proposalCount),
    criteriaMetadataCID: "",
  };
}

function getProvider(): BrowserProvider | JsonRpcProvider {
  if (window.ethereum) return new BrowserProvider(window.ethereum as any);
  return new JsonRpcProvider(SEPOLIA_RPC);
}

export function useProtocol(walletAddress?: string | null) {
  const [pools,   setPools]   = useState<GrantPool[]>([]);
  const [stats,   setStats]   = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = getProvider();
      const factory  = new Contract(
        (import.meta.env.VITE_FACTORY_CONTRACT_ADDRESS as string) || "0x0Ac0cBF23279be96A31618B45A7EA65C603e0825",
        FactoryABI,
        provider,
      );

      const [summaries, statsRaw] = await Promise.all([
        factory.getAllPoolSummaries(),
        factory.getProtocolStats(),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mapped: GrantPool[] = (summaries as any[]).map(mapSummary);

      // If wallet connected, check signer status across all pools in parallel
      if (walletAddress) {
        const signerFlags = await Promise.all(
          mapped.map((pool) => {
            const pc = new Contract(pool.address, GrantPoolABI, provider);
            return (pc.isSigner(walletAddress) as Promise<boolean>).catch(() => false);
          }),
        );
        mapped = mapped.map((pool, i) => ({
          ...pool,
          // Store wallet address in signers[] only if user IS a signer — PoolCard
          // uses signers.some() for role badge; signerCount is the real total.
          signers: signerFlags[i] ? [walletAddress] : [],
        }));
      }

      setPools(mapped);
      setStats({
        totalPools:          Number(statsRaw.totalPools),
        activePools:         Number(statsRaw.activePools),
        totalFunded:         (statsRaw.totalDeposited     as bigint).toString(),
        totalWinners:        Number(statsRaw.totalWinners),
        totalGrantsClaimed:  (statsRaw.totalGrantsClaimed as bigint).toString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("useProtocol error:", err);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => { load(); }, [load]);

  return { pools, stats, loading, error, refetch: load };
}
