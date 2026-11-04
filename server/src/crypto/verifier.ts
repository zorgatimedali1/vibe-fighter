import { Contract, JsonRpcProvider, Wallet, getAddress, verifyMessage, type EventLog, type TypedDataDomain } from 'ethers';

/** Escrow ABI subset. The event is the source of truth that both $1 stakes are locked. */
export const ESCROW_ABI = [
  'event MatchLocked(uint256 indexed matchId, address player1, address player2, uint256 totalPot)',
];

export interface LockedMatch { player1: string; player2: string; totalPot: bigint }

export interface VerifierConfig {
  rpcUrl: string; escrow: string; chainId: number;
  confirmations: number; minPot: bigint; lookbackBlocks?: number;
}

/** Wallet login message. The nonce binds the signature to this socket session. */
export const authMessage = (nonce: string) => `Voxel Fighter sign-in\nNonce: ${nonce}`;

export function verifyLogin(address: string, message: string, signature: string): boolean {
  try { return getAddress(verifyMessage(message, signature)) === getAddress(address); } catch { return false; }
}

export class EscrowVerifier {
  private provider: JsonRpcProvider;
  private contract: Contract;
  constructor(private cfg: VerifierConfig) {
    this.provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId);
    this.contract = new Contract(cfg.escrow, ESCROW_ABI, this.provider);
  }

  /**
   * Resolves once MatchLocked(matchId, ...) exists on-chain with enough confirmations and a big enough pot.
   * First scans recent history (players often lock before the socket connects), then listens live.
   */
  async waitForLocked(matchId: string, timeoutMs = 120_000): Promise<LockedMatch> {
    const id = BigInt(matchId);
    const filter = this.contract.filters.MatchLocked(id);

    const accept = async (blockNumber: number, p1: string, p2: string, pot: bigint): Promise<LockedMatch> => {
      if (pot < this.cfg.minPot) throw new Error(`pot ${pot} below minimum ${this.cfg.minPot}`);
      while ((await this.provider.getBlockNumber()) - blockNumber < this.cfg.confirmations) {
        await new Promise((r) => setTimeout(r, 2000));       // wait out reorg risk
      }
      return { player1: getAddress(p1), player2: getAddress(p2), totalPot: pot };
    };

    const latest = await this.provider.getBlockNumber();
    const past = await this.contract.queryFilter(filter, Math.max(0, latest - (this.cfg.lookbackBlocks ?? 50_000)), latest);
    const found = past.find((l): l is EventLog => 'args' in l && !l.removed);
    if (found) return accept(found.blockNumber, found.args[1], found.args[2], found.args[3]);

    return new Promise<LockedMatch>((resolve, reject) => {
      const timer = setTimeout(() => { this.contract.off(filter, handler); reject(new Error('timed out waiting for MatchLocked')); }, timeoutMs);
      const handler = (_id: bigint, p1: string, p2: string, pot: bigint, ev: { log: EventLog }) => {
        clearTimeout(timer); this.contract.off(filter, handler);
        accept(ev.log.blockNumber, p1, p2, pot).then(resolve, reject);
      };
      this.contract.on(filter, handler);
    });
  }
}

/* ------------------------- EIP-712 payout signature ------------------------- */

export const VICTORY_TYPES = {
  Victory: [
    { name: 'matchId', type: 'uint256' }, { name: 'winner', type: 'address' },
    { name: 'p1Rounds', type: 'uint8' }, { name: 'p2Rounds', type: 'uint8' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export interface VictoryMessage { matchId: string; winner: string; p1Rounds: number; p2Rounds: number; deadline: number }

export class VictorySigner {
  private wallet: Wallet;
  private domain: TypedDataDomain;
  /** The escrow must be deployed with this domain ("VoxelFighterEscrow", "1") and trust this signer address. */
  constructor(privateKey: string, chainId: number, verifyingContract: string) {
    this.wallet = new Wallet(privateKey);
    this.domain = { name: 'VoxelFighterEscrow', version: '1', chainId, verifyingContract };
  }
  get address() { return this.wallet.address; }
  sign(m: VictoryMessage): Promise<string> {
    return this.wallet.signTypedData(this.domain, VICTORY_TYPES, {
      matchId: BigInt(m.matchId), winner: getAddress(m.winner),
      p1Rounds: m.p1Rounds, p2Rounds: m.p2Rounds, deadline: BigInt(m.deadline),
    });
  }
}
