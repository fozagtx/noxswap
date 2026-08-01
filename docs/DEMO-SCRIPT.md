# Final demo script (max 4:00)

Read the SAY lines out loud, do the DO lines on screen. Practice once, then
record with Cmd+Shift+5 (browser window + microphone).

Accounts in MetaMask: Alice `0xdE15…7274` (start on her), Bob `0xb4BC…a5a6`.
App: https://noxswap.vercel.app · Repo: https://github.com/fozagtx/noxswap
Vault: https://sepolia.etherscan.io/address/0xdce40a86655121acb4745ff641ec9ccb0267182a

---

## 0:00 — The problem

DO: Show any ordinary swap transaction on sepolia.etherscan.io.

SAY: "This is a normal swap on Uniswap. Anyone in the world can see who
traded, what they sold, how much, and in which direction. That is why
sandwich bots exist, and why serious traders will not bring size on chain.
I built NoxSwap to fix that, without changing Uniswap at all."

## 0:25 — The product

DO: Open noxswap.vercel.app, scroll the landing once, press Connect wallet
as Alice.

SAY: "This is NoxSwap, a dark pool that sits on top of Uniswap. You trade
without showing your hand. Let me show you with two traders, Alice and Bob."

## 0:45 — Alice seals an order

DO: Balances, Deposit tab, WETH, amount 0.002, Deposit. Confirm both popups.

SAY: "Alice deposits into the vault. From this moment her balance is
scrambled. The chain stores an encrypted reference that only she can decode."

DO: Trade, Sell WETH for USDC, amount 0.001, Place sealed order. Confirm.

SAY: "Now she places an order: sell WETH for USDC. The amount and the
direction are sealed in her browser before anything is sent."

DO: Click the new transaction link in Activity, show it on Etherscan.

SAY: "Here is that order on chain. No amount. No direction. Just a sealed
envelope. There is nothing here for a bot to attack."

## 1:45 — Bob takes the other side

DO: Switch MetaMask to Bob. The page reloads by itself. Connect. Balances,
Deposit, USDC, amount 5, Deposit. Then Trade, Sell USDC for WETH, amount 5,
Place sealed order.

SAY: "Bob takes the other side. He deposits five USDC and places the
opposite order. Neither of them can see the other's order. Nobody can."

## 2:20 — Close and settle

DO: Batches, Close batch, confirm.

SAY: "The batch closes. Only two numbers ever become public: the total on
each side. The individual orders stay sealed forever."

DO: Settle batch. While the spinner runs, keep talking. Confirm the
transaction when it appears.

SAY: "Settlement is open to anyone. The proofs come out of a secure enclave
and the contract verifies them itself before it acts, so there is no
operator to trust. Inside the batch, Alice and Bob just matched each other
at the market price. Zero slippage, zero MEV. Only the tiny unmatched
leftover goes out to Uniswap."

DO: Open the settle transaction from Activity on Etherscan.

SAY: "And here is the proof. Alice sold a thousandth of an ETH, but the pool
only received the leftover after Bob's five dollars matched her privately."

## 3:20 — The payoff

DO: Balances, Show my balance as Bob. Then switch MetaMask to Alice, Show my
balance again.

SAY: "Bob decodes his balance and his WETH is there. Alice decodes hers,
paid in USDC at the same fair price. Each of them sees only their own
numbers. Everyone else sees scrambled data."

## 3:45 — Close

DO: Show the landing page or the GitHub repo.

SAY: "NoxSwap. Sealed orders, private matching, and a public footprint that
gives bots nothing to eat. Live on Sepolia, built on iExec Nox, with Uniswap
completely unmodified. The code is open, links below."

---

## After recording

1. Trim to under 4:00 in QuickTime (Edit, Trim), export as .mp4
2. Post on X: copy docs/X-POST.md, attach the video, tag @iEx_ec
3. Submit on DoraHacks: repo link, X post link, https://noxswap.vercel.app
4. Deadline 21:59 tonight
