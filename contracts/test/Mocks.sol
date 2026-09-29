// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Test doubles for DolphinSwapGuard. Never deployed anywhere real.

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * A V2-shaped router with a fixed 2:1 price that pays out of its own balance.
 * `cheat` makes it deliver less than it quoted, to test the received check.
 */
contract MockRouter {
    uint256 public cheatBps;
    address public lastRecipient;

    function setCheat(uint256 bps) external {
        cheatBps = bps;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external pure returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) amounts[i] = amounts[i - 1] * 2;
    }

    function _out(uint256 amountIn, uint256 hops) private view returns (uint256 out) {
        out = amountIn * (2 ** hops);
        out = out - (out * cheatBps) / 10_000;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn, uint256, address[] calldata path, address to, uint256
    ) external {
        lastRecipient = to;
        MockToken(path[0]).transferFrom(msg.sender, address(this), amountIn);
        MockToken(path[path.length - 1]).transfer(to, _out(amountIn, path.length - 1));
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256, address[] calldata path, address to, uint256) external payable {
        lastRecipient = to;
        MockToken(path[path.length - 1]).transfer(to, _out(msg.value, path.length - 1));
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn, uint256, address[] calldata path, address to, uint256
    ) external {
        lastRecipient = to;
        MockToken(path[0]).transferFrom(msg.sender, address(this), amountIn);
        (bool ok, ) = to.call{value: _out(amountIn, path.length - 1)}("");
        require(ok, "eth");
    }

    receive() external payable {}
}
