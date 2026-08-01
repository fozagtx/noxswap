// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Local-network stand-ins for the Uniswap V3 router and pool, used only by
// the integration tests (the Sepolia deployment targets the real contracts).
// The router swaps at the price reported by the pool's sqrtPriceX96 out of
// reserves it has been pre-funded with.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TestERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockUniswapV3Pool {
    uint160 public sqrtPriceX96;
    address public token0;
    address public token1;

    constructor(uint160 sqrtPriceX96_, address token0_, address token1_) {
        sqrtPriceX96 = sqrtPriceX96_;
        token0 = token0_;
        token1 = token1_;
    }

    function setSqrtPriceX96(uint160 sqrtPriceX96_) external {
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}

contract MockSwapRouter {
    using SafeERC20 for IERC20;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    MockUniswapV3Pool public immutable pool;
    address public immutable token0;

    constructor(MockUniswapV3Pool pool_, address token0_) {
        pool = pool_;
        token0 = token0_;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut) {
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        // price = token1 per token0
        if (params.tokenIn == token0) {
            amountOut = (params.amountIn * priceX192) >> 192;
        } else {
            amountOut = (params.amountIn << 192) / priceX192;
        }
        require(amountOut >= params.amountOutMinimum, "slippage");
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
