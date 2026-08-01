import { parseAbi } from "viem";

// Human-readable ABI for NoxSwapVault. externalEuint256/euint256 are
// user-defined value types over bytes32, so they surface as bytes32 here.
export const vaultAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function submitIntent(bytes32 amountHandle, bytes amountProof, bytes32 dirHandle, bytes dirProof)",
  "function requestWithdraw(address token, bytes32 amountHandle, bytes amountProof)",
  "function finalizeWithdraw(bytes decryptionProof)",
  "function closeEpoch()",
  "function settleEpoch(uint256 epochId, bytes proofIn0, bytes proofIn1)",
  "function grantAuditorView(address viewer)",
  "function currentEpochId() view returns (uint256)",
  "function balanceHandles(address user) view returns (bytes32 h0, bytes32 h1)",
  "function epochTotalsHandles(uint256 epochId) view returns (bytes32 h0, bytes32 h1)",
  "function epochInfo(uint256 epochId) view returns (uint256 participantCount, bool closed, bool settled, uint256 revealedIn0, uint256 revealedIn1, uint256 out1PerSide0, uint256 out0PerSide1)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Deposited(address indexed user, address indexed token, uint256 amount)",
  "event Withdrawn(address indexed user, address indexed token, uint256 amount)",
  "event IntentSubmitted(uint256 indexed epochId, address indexed user)",
  "event EpochClosed(uint256 indexed epochId, bytes32 totalIn0Handle, bytes32 totalIn1Handle)",
  "event EpochSettled(uint256 indexed epochId, uint256 totalIn0, uint256 totalIn1, uint256 residualSwapped, bool residualIsToken0)",
  "event WithdrawalRequested(address indexed user, address indexed token, bytes32 amountHandle)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
