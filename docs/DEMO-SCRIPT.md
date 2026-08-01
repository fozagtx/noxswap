# Demo video script (max 4:00)

Deployed: NoxSwapVault `0xdce40a86655121acb4745ff641ec9ccb0267182a` (Sepolia)
Uniswap WETH/USDC 0.3% pool: `0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50`
Vault on Etherscan: https://sepolia.etherscan.io/address/0xdce40a86655121acb4745ff641ec9ccb0267182a

Live app: https://noxswap.vercel.app · Repo: https://github.com/fozagtx/noxswap

Real transaction trail from the verified two-party run (epoch #0):
- Alice deposit WETH: https://sepolia.etherscan.io/tx/0x7ffde6f91bee0dc99dbfcdda333bc5abdd3883d0e4e3d21142f8fc0d48001176
- Bob deposit USDC: https://sepolia.etherscan.io/tx/0xbdd06e2562a6b34d492eb1a343178843a5297613c8d9215c61c200a015f7aba9
- Alice sealed intent (sell WETH): https://sepolia.etherscan.io/tx/0x8c356f4f70f03098e551eb2ac6de5bba1fc235bcf7c7e4c00f3a9f17075a5f28
- Bob sealed intent (sell USDC): https://sepolia.etherscan.io/tx/0x63fdbd64ec0c2c5fba24c111c0748339309728341dc0073c336288d615cd096e
- Epoch closed (aggregates only): https://sepolia.etherscan.io/tx/0x2ed16bf7848206737884e3979e95328e54f94cef2ddc90878cf9d30398d9832e
- Settlement (netted + residual on Uniswap): https://sepolia.etherscan.io/tx/0x6a3085ca85fa1b00e347d28ea96213e10446f3eea44b7a81e3b972d393d7ba6a
- Result: aggregates 0.004 WETH vs 1 USDC → Bob crossed internally at spot
  (got 0.0000434 WETH, zero slippage); only ~0.00396 WETH residual hit
  Uniswap; Alice cleared 91.79 USDC. all balances confidential.

---

**0:00–0:35. The problem.**
Screen: Etherscan of any normal Uniswap swap.
"Every swap on Uniswap is public before and after it executes: who, which
direction, how much. That's what sandwich bots feed on, and it's why funds
can't rebalance without broadcasting their strategy. NoxSwap fixes the leak
without touching Uniswap."

**0:35–1:20. Deposit + sealed intent (UI).**
Screen: NoxSwap UI, wallet A connected.
- Deposit WETH. Point at the balance card: "on-chain, my balance is this
  opaque 32-byte handle. only I can decrypt it. Computation happens inside
  Intel TDX enclaves via iExec's Nox protocol."
- Submit intent, toggle direction: "amount AND direction are encrypted in the
  browser before anything is sent. The chain sees a handle, nothing else."
- Show the submitIntent tx on Etherscan: only bytes32 handles visible.

**1:20–1:50. Second party (wallet B).**
Screen: switch account, submit the opposing intent (sell USDC).
"A second trader takes the other side. Neither of us. nor anyone watching.
can see the other's order."

**1:50–2:50. Close + settle: the netting proof.**
Screen: Batches panel → Close epoch → Settle.
- "Closing the epoch reveals exactly two numbers: the aggregate sum per side.
  Individual intents stay sealed forever."
- "Settlement is permissionless. the browser fetches decryption proofs from
  the gateway, and the contract verifies them on-chain before acting."
- Etherscan on the settle tx: "here's the kicker. my order was X WETH, but
  the pool only saw the residual, because the opposing flow crossed privately
  at spot inside the enclave. Zero slippage, zero MEV on the crossed portion.
  Uniswap: completely unmodified."

**2:50–3:25. After: balances + withdrawal + auditor.**
- Decrypt balances in both wallets: correct fills at the uniform price.
- Two-phase withdrawal: "only the withdrawn amount is revealed. which an
  ERC-20 transfer makes public anyway. The running balance never is."
- One line on `grantAuditorView`: "selective disclosure for compliance via
  the on-chain ACL."

**3:25–4:00. Close.**
Architecture slide (contract diagram from README).
"Encrypted intents. TEE netting. Residual-only execution. Trustless proof
verification. Built on iExec Nox, live on Sepolia, code on GitHub. This is
how privacy composes with public DeFi."
